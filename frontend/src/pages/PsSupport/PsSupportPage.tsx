import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box, Grid, Card, CardContent, Typography, Button,
  TextField, IconButton, Avatar, Chip, Divider, List, ListItemButton,
  ListItemText, Paper, alpha, CircularProgress, Tooltip, Badge,
  FormControl, InputLabel, Select, MenuItem, Alert, Collapse,
  Dialog, DialogTitle, DialogContent, DialogActions, Accordion,
  AccordionSummary, AccordionDetails,
} from '@mui/material'
import {
  SendOutlined, StopOutlined, AddOutlined, SmartToyOutlined, PersonOutlined,
  DeleteOutlined, ChatOutlined, BoltOutlined, PlayArrowOutlined,
  EditOutlined, ScheduleOutlined, CheckCircleOutlined, ErrorOutlined,
  ArrowForwardOutlined, ContentCopyOutlined, SearchOutlined,
  ApiOutlined, ExpandMoreOutlined, LinkOutlined, CloseOutlined,
  AutoFixHighOutlined, CodeOutlined, EmailOutlined, StorageOutlined,
  ManageSearchOutlined, TableChartOutlined, AssessmentOutlined, DownloadOutlined,
  BugReportOutlined, PrecisionManufacturingOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { psApi, agentsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import WorkflowDialog from './components/WorkflowDialog'
import WorkflowDetail from './components/WorkflowDetail'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import PSAIDebugPanel from './components/PSAIDebugPanel'
import type { PsConversation, Workflow, PsApiEntry } from '@/types'

interface ToolCall {
  tool: string
  input: Record<string, any>
  output: Record<string, any>
}

interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  id: string
  toolCalls?: ToolCall[]
}

// ── Tool step icons / labels ───────────────────────────────────────────────────
const TOOL_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  lookup_schema:        { label: 'Schema Lookup',         icon: <ManageSearchOutlined sx={{ fontSize: 14 }} />, color: '#555555' },
  generate_sql:         { label: 'Generate SQL',           icon: <CodeOutlined sx={{ fontSize: 14 }} />,         color: '#01398c' },
  execute_sql:          { label: 'Execute SQL',            icon: <StorageOutlined sx={{ fontSize: 14 }} />,      color: '#059669' },
  list_api_endpoints:   { label: 'List APIs',              icon: <ApiOutlined sx={{ fontSize: 14 }} />,          color: '#64748B' },
  execute_api:          { label: 'API Call',               icon: <LinkOutlined sx={{ fontSize: 14 }} />,         color: '#1A5099' },
  execute_api_for_rows: { label: 'Sequential API Calls',   icon: <AssessmentOutlined sx={{ fontSize: 14 }} />,   color: '#059669' },
  generate_report:      { label: 'Generate Report',        icon: <AssessmentOutlined sx={{ fontSize: 14 }} />,   color: '#01398c' },
  preview_email:        { label: 'Email Preview',          icon: <EmailOutlined sx={{ fontSize: 14 }} />,        color: '#D97706' },
  send_email:           { label: 'Send Email',             icon: <EmailOutlined sx={{ fontSize: 14 }} />,        color: '#059669' },
  call_api:             { label: 'API Call',               icon: <LinkOutlined sx={{ fontSize: 14 }} />,         color: '#1A5099' },
  query_data:           { label: 'Query Data',             icon: <TableChartOutlined sx={{ fontSize: 14 }} />,   color: '#01398c' },
}

// ── Single tool step card ──────────────────────────────────────────────────────
function ToolStep({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[tc.tool] ?? { label: tc.tool, icon: <BoltOutlined sx={{ fontSize: 14 }} />, color: '#64748b' }

  // Build a readable summary of the output
  const summary = (() => {
    const o = tc.output ?? {}
    if (tc.tool === 'generate_sql' && o.sql) return o.sql as string
    if (tc.tool === 'execute_sql' && o.rows) return `${(o.rows as any[]).length} row(s) returned`
    if (tc.tool === 'execute_sql' && o.error) return `Error: ${o.error}`
    if (tc.tool === 'preview_email' && o.subject) return `To: ${o.to} — ${o.subject}`
    if (tc.tool === 'send_email') return o.sent ? 'Email sent' : 'Email failed'
    if (tc.tool === 'execute_api' && o.status_code) return `HTTP ${o.status_code}`
    if (tc.tool === 'call_api' && o.status) return `HTTP ${o.status}`
    if (tc.tool === 'execute_api_for_rows') return `${o.succeeded ?? 0}/${o.total ?? 0} calls succeeded`
    if (tc.tool === 'list_api_endpoints' && o.endpoints) return `${(o.endpoints as any[]).length} endpoint(s) found`
    if (tc.tool === 'lookup_schema' && o.matched_columns) return `${(o.matched_columns as any[]).length} column(s) matched`
    return JSON.stringify(o).slice(0, 80)
  })()

  return (
    <Box
      sx={{
        mb: 0.5, borderRadius: 1.5, overflow: 'hidden',
        border: '1px solid', borderColor: alpha(meta.color, 0.3),
        bgcolor: (t) => alpha(meta.color, t.palette.mode === 'dark' ? 0.08 : 0.04),
      }}
    >
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75,
          cursor: 'pointer', userSelect: 'none',
          '&:hover': { bgcolor: (t) => alpha(meta.color, 0.06) },
        }}
      >
        <Box sx={{ color: meta.color, display: 'flex' }}>{meta.icon}</Box>
        <Typography variant="caption" fontWeight={700} sx={{ color: meta.color, flex: 1 }}>
          {meta.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 260, fontSize: '0.688rem' }}>
          {summary}
        </Typography>
        <ExpandMoreOutlined sx={{ fontSize: 14, color: 'text.disabled', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }} />
      </Box>
      <Collapse in={open}>
        <Box sx={{ borderTop: '1px solid', borderColor: alpha(meta.color, 0.2), px: 1.5, py: 1 }}>
          {/* Input */}
          {tc.input && Object.keys(tc.input).length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: '0.625rem', textTransform: 'uppercase' }}>Input</Typography>
              <Box sx={{
                p: 1, borderRadius: 1, bgcolor: '#0d1117',
                fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8',
                whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto',
              }}>
                {tc.tool === 'generate_sql' || tc.tool === 'execute_sql'
                  ? (tc.input.sql || JSON.stringify(tc.input, null, 2))
                  : JSON.stringify(tc.input, null, 2)}
              </Box>
            </Box>
          )}
          {/* Output */}
          {tc.output && (
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: '0.625rem', textTransform: 'uppercase' }}>Output</Typography>
              {tc.tool === 'execute_sql' && tc.output.rows ? (
                // Render as table for SQL results
                (() => {
                  const cols = tc.output.columns as string[] ?? []
                  const rows = tc.output.rows as Record<string, any>[] ?? []
                  return (
                    <Box sx={{ overflow: 'auto', maxHeight: 180 }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.75rem' }}>
                        <thead>
                          <tr>{cols.map((c) => <th key={c} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#60a5fa', fontWeight: 700 }}>{c}</th>)}</tr>
                        </thead>
                        <tbody>
                          {rows.map((row, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#0d1117' : '#111827' }}>
                              {cols.map((c) => <td key={c} style={{ padding: '3px 8px', color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>{String(row[c] ?? '')}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Box>
                  )
                })()
              ) : (
                <Box sx={{
                  p: 1, borderRadius: 1, bgcolor: '#0d1117',
                  fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8',
                  whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto',
                }}>
                  {JSON.stringify(tc.output, null, 2)}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Parse markdown table from message content ─────────────────────────────────
function parseMarkdownTable(content: string): { cols: string[]; rows: string[][] } {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  if (lines.length < 2) return { cols: [], rows: [] }
  const parseCells = (line: string) =>
    line.split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
  const cols = parseCells(lines[0])
  // Skip separator line (---|---|...)
  const rows = lines.slice(2).map(parseCells).filter((r) => r.length === cols.length)
  return { cols, rows }
}

// ── Report data dialog ─────────────────────────────────────────────────────────
function ReportDialog({ open, onClose, msg }: { open: boolean; onClose: () => void; msg: ChatBubble }) {
  // Parse table from message content (works even when tool calls aren't attached)
  const { cols, rows } = parseMarkdownTable(msg.content)
  // Also try tool calls for SQL text
  const sqlText: string = msg.toolCalls?.find((t) => t.tool === 'generate_sql')?.output?.sql ?? ''

  const exportCsv = () => {
    const header = cols.join(',')
    const lines = rows.map((r) => r.map((c) => JSON.stringify(c)).join(','))
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'report.csv'; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontWeight: 700 }}>
        <AssessmentOutlined color="primary" />
        Query Results
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          {rows.length > 0 && (
            <Button size="small" variant="outlined" startIcon={<DownloadOutlined />} onClick={exportCsv}>
              Export CSV
            </Button>
          )}
          <IconButton size="small" onClick={onClose}><CloseOutlined fontSize="small" /></IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {sqlText && (
          <Box sx={{ px: 2, py: 1.5, bgcolor: '#0d1117', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" color="#60a5fa" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap', display: 'block' }}>
              {sqlText}
            </Typography>
          </Box>
        )}
        {cols.length > 0 ? (
          <Box sx={{ overflow: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.813rem' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#f8fafc' }}>
                  {cols.map((c) => (
                    <th key={c} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, whiteSpace: 'nowrap' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary" variant="body2">No table found in this message.</Typography>
            <Button sx={{ mt: 1 }} size="small" startIcon={<ContentCopyOutlined />}
              onClick={() => navigator.clipboard.writeText(msg.content)}>
              Copy message
            </Button>
          </Box>
        )}
      </DialogContent>
      {rows.length > 0 && (
        <DialogActions sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">{rows.length} row{rows.length !== 1 ? 's' : ''} · {cols.length} columns</Typography>
        </DialogActions>
      )}
    </Dialog>
  )
}

// ── RCA Card ───────────────────────────────────────────────────────────────────
interface RcaData {
  problem?: string
  steps_executed?: Array<{ tool?: string; input?: unknown; output?: unknown }>
  findings?: string
  root_cause?: string
  fix_applied?: string
  final_status?: string
}

function RCACard({ data, onCreateWorkflow }: { data: RcaData; onCreateWorkflow?: () => void }) {
  const isSuccess = data.final_status?.toLowerCase() === 'success' || data.final_status?.toLowerCase() === 'resolved'
  const statusColor = isSuccess ? '#10b981' : '#ef4444'

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 1, p: 1.5, borderRadius: 2,
        borderColor: alpha(statusColor, 0.4),
        bgcolor: alpha(statusColor, 0.04),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {isSuccess
          ? <CheckCircleOutlined sx={{ fontSize: 16, color: '#10b981' }} />
          : <ErrorOutlined sx={{ fontSize: 16, color: '#ef4444' }} />}
        <Typography variant="caption" fontWeight={800} sx={{ color: statusColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          RCA — {data.final_status ?? 'Unknown'}
        </Typography>
      </Box>
      {data.problem && (
        <Box sx={{ mb: 0.75 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">Problem</Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{data.problem}</Typography>
        </Box>
      )}
      {data.root_cause && (
        <Box sx={{ mb: 0.75 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">Root Cause</Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{data.root_cause}</Typography>
        </Box>
      )}
      {data.fix_applied && (
        <Box sx={{ mb: 0.75 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">Fix Applied</Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{data.fix_applied}</Typography>
        </Box>
      )}
      {onCreateWorkflow && (
        <Button
          size="small" variant="outlined" startIcon={<BoltOutlined />}
          onClick={onCreateWorkflow}
          sx={{ mt: 0.5, fontSize: '0.688rem' }}
        >
          Create Fix Workflow
        </Button>
      )}
    </Paper>
  )
}

function extractRca(content: string): RcaData | null {
  const m = content.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1])
    if (parsed.root_cause || parsed.final_status || parsed.problem) return parsed
    return null
  } catch {
    return null
  }
}

// ── Message Bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, onRcaWorkflow }: { msg: ChatBubble; onRcaWorkflow?: (rca: RcaData) => void }) {
  const isUser = msg.role === 'user'
  const [reportOpen, setReportOpen] = useState(false)
  // Detect if the message contains a markdown table
  const hasTable = !isUser && /\|.+\|/.test(msg.content)
  // Parse RCA block from assistant messages
  const rca = !isUser ? extractRca(msg.content) : null

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 2, gap: 1.5, alignItems: 'flex-start',
      }}
    >
      {!isUser && (
        <Avatar sx={{ width: 32, height: 32, mt: 0.5, background: 'linear-gradient(135deg, #7c3aed, #2563eb)', flexShrink: 0 }}>
          <SmartToyOutlined sx={{ fontSize: 16 }} />
        </Avatar>
      )}
      <Box sx={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {/* Tool steps — shown above the assistant reply */}
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <Box>
            {msg.toolCalls.map((tc, i) => <ToolStep key={i} tc={tc} />)}
          </Box>
        )}
        <Box
          sx={{
            p: 1.75,
            borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
            bgcolor: isUser ? 'primary.main' : 'background.paper',
            color: isUser ? 'white' : 'text.primary',
            boxShadow: 2,
            border: isUser ? 'none' : '1px solid',
            borderColor: 'divider',
            fontSize: '0.875rem',
            lineHeight: 1.7,
            wordBreak: 'break-word',
            '& table': { borderCollapse: 'collapse', width: '100%', mb: 1, fontSize: '0.813rem' },
            '& th, & td': { border: '1px solid', borderColor: 'divider', px: 1.5, py: 0.5, textAlign: 'left' },
            '& th': { bgcolor: 'action.hover', fontWeight: 700 },
            '& pre': { bgcolor: 'action.hover', p: 1.5, borderRadius: 1, overflowX: 'auto', fontSize: '0.813rem', fontFamily: 'monospace' },
            '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.813rem' },
            '& p': { m: 0, mb: 0.75 },
            '& p:last-child': { mb: 0 },
            '& ul, & ol': { pl: 2.5, mb: 0.75 },
          }}
        >
          {isUser ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          )}
        </Box>
        {/* Action bar for assistant messages */}
        {!isUser && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5 }}>
            {hasTable && (
              <Tooltip title="View data / Export CSV">
                <Chip
                  icon={<AssessmentOutlined sx={{ fontSize: 13, '&&': { color: '#2563eb' } }} />}
                  label="Report"
                  size="small"
                  variant="outlined"
                  onClick={() => setReportOpen(true)}
                  sx={{ height: 22, fontSize: '0.688rem', borderColor: alpha('#2563eb', 0.4), color: '#2563eb', fontWeight: 600, cursor: 'pointer' }}
                />
              </Tooltip>
            )}
            <Tooltip title="Copy response">
              <IconButton size="small" sx={{ p: 0.25, opacity: 0.5, '&:hover': { opacity: 1 } }}
                onClick={() => navigator.clipboard.writeText(msg.content)}>
                <ContentCopyOutlined sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        {reportOpen && <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} msg={msg} />}
        {rca && (
          <RCACard data={rca} onCreateWorkflow={onRcaWorkflow ? () => onRcaWorkflow(rca) : undefined} />
        )}
      </Box>
      {isUser && (
        <Avatar sx={{ width: 32, height: 32, mt: 0.5, bgcolor: 'primary.dark', flexShrink: 0 }}>
          <PersonOutlined sx={{ fontSize: 16 }} />
        </Avatar>
      )}
    </Box>
  )
}

// ── API Entry Row ──────────────────────────────────────────────────────────────
function ApiEntryRow({
  entry,
  onDelete,
}: {
  entry: PsApiEntry
  onDelete: () => void
}) {
  const methodColor: Record<string, string> = {
    GET: '#10b981', POST: '#2563eb', PUT: '#d97706', DELETE: '#ef4444', PATCH: '#7c3aed',
  }
  const color = methodColor[entry.method?.toUpperCase() ?? 'GET'] ?? '#64748b'
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1, py: 0.75, borderRadius: 1.5,
        border: '1px solid', borderColor: 'divider',
        mb: 0.75, bgcolor: 'background.paper',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Chip
        label={entry.method}
        size="small"
        sx={{ bgcolor: alpha(color, 0.12), color, fontWeight: 700, fontSize: '0.625rem', height: 18, minWidth: 38 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" fontWeight={600} noWrap display="block">
          {entry.name}
        </Typography>
        <Typography variant="caption" color="text.disabled" noWrap display="block" sx={{ fontSize: '0.625rem' }}>
          {entry.url}
        </Typography>
      </Box>
      <IconButton size="small" onClick={onDelete} sx={{ opacity: 0.45, '&:hover': { opacity: 1, color: 'error.main' } }}>
        <DeleteOutlined sx={{ fontSize: 13 }} />
      </IconButton>
    </Box>
  )
}

// ── Add API Dialog ─────────────────────────────────────────────────────────────
function AddApiDialog({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: Omit<PsApiEntry, 'id'>) => void
  saving: boolean
}) {
  const [name, setName] = useState('')
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [headers, setHeaders] = useState('')
  const [body, setBody] = useState('')

  const reset = () => { setName(''); setMethod('GET'); setUrl(''); setDescription(''); setHeaders(''); setBody('') }

  const handleClose = () => { reset(); onClose() }
  const handleSave = () => {
    if (!name.trim() || !url.trim()) return
    onSave({ name: name.trim(), method, url: url.trim(), description, headers_json: headers, body_template: body })
    reset()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ApiOutlined color="primary" />
          Add API Entry
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Name *" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" placeholder="e.g. Get Employee" />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Method</InputLabel>
              <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="URL *" value={url} onChange={(e) => setUrl(e.target.value)} fullWidth size="small" placeholder="https://api.example.com/endpoint" />
          </Box>
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" placeholder="What this API does" />
          <TextField
            label="Headers (JSON)"
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            fullWidth size="small" multiline rows={2}
            placeholder={'{"Authorization": "Bearer {{token}}"}'}
            sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
          />
          <TextField
            label="Body Template (JSON)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            fullWidth size="small" multiline rows={3}
            placeholder={'{"employeeId": "{{emp_id}}"}'}
            sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!name.trim() || !url.trim() || saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <AddOutlined />}
        >
          Add API
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Create Workflow from Chat Dialog ──────────────────────────────────────────
function CreateFromChatDialog({
  open,
  conversationId,
  onClose,
  onCreated,
}: {
  open: boolean
  conversationId: number | null
  onClose: () => void
  onCreated: (wf: Workflow) => void
}) {
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const mutation = useMutation({
    mutationFn: () => psApi.createFromConversation(conversationId!, name.trim(), description.trim() || undefined),
    onSuccess: (wf) => {
      enqueueSnackbar(`Workflow "${wf.name}" created`, { variant: 'success' })
      onCreated(wf)
      setName('')
      setDescription('')
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BoltOutlined sx={{ color: 'warning.main' }} />
          Create Workflow from Chat
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The AI will extract workflow steps from this conversation automatically.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Workflow Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth size="small"
            placeholder="e.g. Daily Sales Report"
            autoFocus
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth size="small"
            placeholder="Optional description"
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || !conversationId || mutation.isPending}
          startIcon={mutation.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighOutlined />}
        >
          Extract & Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Workflow Card ──────────────────────────────────────────────────────────────
function WorkflowCard({
  wf, onSelect, onRun, onEdit, isRunning,
}: {
  wf: Workflow
  onSelect: () => void
  onRun: () => void
  onEdit: () => void
  isRunning: boolean
}) {
  const schedule = (wf as any).schedule
  const lastRun = (wf as any).last_run
  const steps = wf.steps ?? []

  const scheduleLabel = !schedule || schedule.schedule_type === 'manual'
    ? 'Manual'
    : schedule.schedule_type === 'interval'
    ? `Every ${schedule.interval_minutes}m`
    : schedule.schedule_type === 'daily'
    ? `Daily ${schedule.run_at_time}`
    : `Weekly ${schedule.run_at_time}`

  return (
    <Card sx={{ cursor: 'pointer', transition: 'all .2s', '&:hover': { transform: 'translateY(-3px)', boxShadow: 4 } }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
          <Avatar sx={{ width: 40, height: 40, borderRadius: 2, background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' }}>
            <BoltOutlined sx={{ fontSize: 20 }} />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap>{wf.name}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {wf.description || 'No description'}
            </Typography>
          </Box>
          {lastRun && (
            lastRun.status === 'success'
              ? <CheckCircleOutlined sx={{ color: 'success.main', fontSize: 18 }} />
              : lastRun.status === 'failed'
              ? <ErrorOutlined sx={{ color: 'error.main', fontSize: 18 }} />
              : null
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={`${steps.length} steps`} size="small" variant="outlined" color="primary" sx={{ fontSize: '0.688rem' }} />
          <Chip
            icon={<ScheduleOutlined sx={{ fontSize: '12px !important' }} />}
            label={scheduleLabel} size="small" variant="outlined" sx={{ fontSize: '0.688rem' }}
          />
          {lastRun && (
            <Chip
              label={`Last: ${lastRun.status}`} size="small"
              color={lastRun.status === 'success' ? 'success' : lastRun.status === 'failed' ? 'error' : 'warning'}
              variant="outlined" sx={{ fontSize: '0.688rem' }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); onSelect() }} endIcon={<ArrowForwardOutlined />} sx={{ flex: 1 }}>
            View
          </Button>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit() }} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <EditOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            size="small" variant="contained" color="success"
            startIcon={isRunning ? <CircularProgress size={12} color="inherit" /> : <PlayArrowOutlined />}
            onClick={(e) => { e.stopPropagation(); onRun() }}
            disabled={isRunning} sx={{ minWidth: 80 }}
          >
            Run
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PsSupportPage() {
  const { enqueueSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  // Prevent conversation history reload from overwriting fresh streaming messages
  const skipNextReloadRef = useRef(false)

  const [pageTab, setPageTab] = useState<'chat' | 'workflows'>('chat')
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [convsCollapsed, setConvsCollapsed] = useState(false)

  // Chat state — connection comes from global store
  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const [model, setModel] = useState('gpt-4o-mini')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatBubble[]>([])

  // Pick up API response context if navigated from API Collection "Send to"
  useEffect(() => {
    const raw = sessionStorage.getItem('api_response_context')
    if (!raw) return
    sessionStorage.removeItem('api_response_context')
    try {
      const ctx = JSON.parse(raw)
      const preview = ctx.body?.length > 800 ? ctx.body.slice(0, 800) + '\n…(truncated)' : ctx.body
      setInput(`Here is an API response from "${ctx.source}" (${ctx.url}):\n\n${preview}\n\nPlease help me understand this data structure and how it could be used.`)
    } catch { /* ignore */ }
  }, [])
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null)
  const [createFromChatOpen, setCreateFromChatOpen] = useState(false)
  const [createAgentOpen, setCreateAgentOpen] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [agentDesc, setAgentDesc] = useState('')

  const createAgentMut = useMutation({
    mutationFn: () => agentsApi.fromPsChat({
      conversation_id: selectedConvId!,
      name: agentName,
      description: agentDesc || undefined,
      conn_id: activeConnection?.id,
    }),
    onSuccess: () => {
      enqueueSnackbar('Agent created — view it in AI Agents', { variant: 'success' })
      setCreateAgentOpen(false)
      setAgentName('')
      setAgentDesc('')
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Agent creation failed', { variant: 'error' }),
  })
  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveTools, setLiveTools] = useState<ToolCall[]>([])   // tool steps as they arrive
  const [liveText, setLiveText] = useState('')                  // partial assistant text
  const [pendingApprovals, setPendingApprovals] = useState<Array<{
    tool_call_id: string; tool: string; input: Record<string, any>; preview: string
  }>>([])
  const [approvalDecisions, setApprovalDecisions] = useState<Record<string, boolean>>({})

  // API Collection state
  const [addApiOpen, setAddApiOpen] = useState(false)
  const navigate = useNavigate()

  // AI Debug state
  const [debugOpen, setDebugOpen] = useState(false)

  // Drag-resize sidebar
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    const startX = e.clientX
    const startW = sidebarRef.current?.offsetWidth ?? sidebarWidth
    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const newW = Math.min(480, Math.max(200, startW + ev.clientX - startX))
      setSidebarWidth(newW)
    }
    const onUp = () => {
      isResizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Workflow state
  const [createOpen, setCreateOpen] = useState(false)
  const [editWorkflow, setEditWorkflow] = useState<Workflow | null>(null)
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null)
  const [runningId, setRunningId] = useState<number | null>(null)

  // Queries
  const { data: conversations = [] } = useQuery({
    queryKey: ['ps-conversations', connId],
    queryFn: () => psApi.listConversations(connId || undefined),
    enabled: pageTab === 'chat' && !!connId,
  })

  const { data: apiCollection = [] } = useQuery({
    queryKey: ['ps-api-collection', connId],
    queryFn: () => psApi.listApiCollection(connId || undefined),
    enabled: pageTab === 'chat' && !!connId,
  })

  const { data: workflows = [], isLoading: wfLoading } = useQuery({
    queryKey: ['ps-workflows', connId],
    queryFn: () => psApi.listWorkflows(connId || undefined),
    enabled: pageTab === 'workflows' && !!connId,
  })

  // Load conversation messages when one is selected (skip if just populated by streaming)
  useEffect(() => {
    if (!selectedConvId) return
    if (skipNextReloadRef.current) {
      skipNextReloadRef.current = false
      return
    }
    psApi.getConversation(selectedConvId).then(({ messages: msgs }) => {
      // Tool messages are saved AFTER their assistant message in the DB.
      // Strategy: for each assistant message, collect all tool messages that
      // immediately follow it (before the next user/assistant message).
      const bubbles: ChatBubble[] = []
      const rawMsgs = msgs as any[]

      for (let i = 0; i < rawMsgs.length; i++) {
        const m = rawMsgs[i]
        if (m.role === 'tool' || m.role === 'tool_pending') continue  // handled below

        if (m.role === 'user' || m.role === 'assistant') {
          const toolCalls: ToolCall[] = []

          if (m.role === 'assistant') {
            // Collect tool messages that immediately follow this assistant message
            let j = i + 1
            while (j < rawMsgs.length && (rawMsgs[j].role === 'tool' || rawMsgs[j].role === 'tool_pending')) {
              const tm = rawMsgs[j]
              if (tm.role === 'tool') {
                try {
                  toolCalls.push({
                    tool: tm.tool_name ?? '',
                    input: tm.tool_input_json ? JSON.parse(tm.tool_input_json) : {},
                    output: tm.tool_output_json ? JSON.parse(tm.tool_output_json) : {},
                  })
                } catch { /* ignore */ }
              }
              j++
            }
          }

          bubbles.push({
            id: String(m.id),
            role: m.role as 'user' | 'assistant',
            content: m.content ?? '',
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          })
        }
      }
      setMessages(bubbles)
    }).catch(() => {})
  }, [selectedConvId])

  // Streaming send — uses /ps/chat/stream NDJSON endpoint
  const streamSendRef = useRef<AbortController | null>(null)

  const doStreamSend = async (
    userMessage: string,
    approvals?: Array<{ tool_call_id: string; approved: boolean; api_id?: number; payload?: any; sql?: string; rows_sql?: string }>,
  ) => {
    // Abort any in-flight request
    streamSendRef.current?.abort()
    const ctrl = new AbortController()
    streamSendRef.current = ctrl

    setIsStreaming(true)
    setLiveTools([])
    setLiveText('')
    setPendingApprovals([])
    setApprovalDecisions({})

    try {
      const res = await fetch('/api/ps/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          message: userMessage,
          conversation_id: selectedConvId ?? undefined,
          conn_id: connId || undefined,
          model: model ?? 'gpt-4o-mini',
          ...(approvals && approvals.length > 0 ? { pending_approvals: approvals } : {}),
        }),
      })

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => 'Request failed')
        throw new Error(err)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      // Use a Map keyed by tool_call_id for reliable matching
      const toolMap = new Map<string, ToolCall & { _key: string }>()
      let toolOrder: string[] = []   // preserves insertion order
      let finalText = ''
      let finalConvId: number | null = null
      let committed = false

      const getOrderedTools = () => toolOrder.map((k) => toolMap.get(k)!).filter(Boolean)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        // NDJSON — split on newlines
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let evt: any
          try { evt = JSON.parse(trimmed) } catch { continue }

          if (evt.conversation_id) finalConvId = evt.conversation_id

          if (evt.type === 'tool_start') {
            const key = evt.tool_call_id ?? `${evt.tool}-${toolOrder.length}`
            toolMap.set(key, { _key: key, tool: evt.tool ?? '', input: {}, output: { _pending: true } })
            toolOrder.push(key)
            setLiveTools(getOrderedTools())

          } else if (evt.type === 'tool_done') {
            // Match by tool_call_id first, then fall back to first pending of same type
            const key = evt.tool_call_id
              ?? toolOrder.find((k) => {
                const t = toolMap.get(k)
                return t && t.tool === evt.tool && (t.output as any)._pending
              })
            if (key && toolMap.has(key)) {
              toolMap.set(key, { _key: key, tool: evt.tool ?? '', input: evt.input ?? {}, output: evt.output ?? {} })
              setLiveTools(getOrderedTools())
            }

          } else if (evt.type === 'message') {
            finalText += evt.content ?? ''
            setLiveText(finalText)

          } else if (evt.type === 'approval_needed') {
            // Collect approval cards — shown after stream ends
            setPendingApprovals((prev) => {
              const exists = prev.some((p) => p.tool_call_id === evt.tool_call_id)
              if (exists) return prev
              return [...prev, { tool_call_id: evt.tool_call_id, tool: evt.tool, input: evt.input ?? {}, preview: evt.preview ?? '' }]
            })
            setApprovalDecisions((prev) => ({ ...prev, [evt.tool_call_id]: false }))

          } else if (evt.type === 'done') {
            finalConvId = evt.conversation_id ?? finalConvId
            committed = true
            // Prefer the authoritative executed list from the backend
            const executedTools: ToolCall[] = (evt.executed ?? []).map((t: any) => ({
              tool: t.tool ?? '',
              input: t.input ?? {},
              output: t.output ?? {},
            }))
            // Fall back to locally tracked tools (strip internal _pending/_key)
            const localTools = getOrderedTools().map(({ _key: _k, ...rest }) => rest as ToolCall)
            const resolvedTools = executedTools.length > 0 ? executedTools
              : localTools.length > 0 ? localTools
              : undefined
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                content: finalText || '(no response)',
                toolCalls: resolvedTools,
              },
            ])
            // Also capture pending approvals from the done payload if not already tracked
            const donePending: any[] = evt.pending_approvals ?? []
            if (donePending.length > 0) {
              setPendingApprovals(donePending.map((p: any) => ({
                tool_call_id: p.tool_call_id,
                tool: p.tool,
                input: p.input ?? {},
                preview: p.preview ?? '',
              })))
              setApprovalDecisions(Object.fromEntries(donePending.map((p: any) => [p.tool_call_id, false])))
            }
            if (finalConvId && !selectedConvId) {
              skipNextReloadRef.current = true   // don't overwrite fresh messages
              setSelectedConvId(finalConvId)
            }
            queryClient.invalidateQueries({ queryKey: ['ps-conversations'] })
            break

          } else if (evt.type === 'error') {
            enqueueSnackbar(evt.detail ?? 'Agent error', { variant: 'error' })
            break
          }
        }
      }

      // Stream ended without a 'done' event — commit whatever we have
      if (!committed && (finalText || toolOrder.length > 0)) {
        const localTools = getOrderedTools().map(({ _key: _k, ...rest }) => rest as ToolCall)
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: finalText || '(no response)',
            toolCalls: localTools.length > 0 ? localTools : undefined,
          },
        ])
        if (finalConvId && !selectedConvId) {
          skipNextReloadRef.current = true
          setSelectedConvId(finalConvId)
        }
        queryClient.invalidateQueries({ queryKey: ['ps-conversations'] })
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        enqueueSnackbar(err?.message ?? 'Streaming failed', { variant: 'error' })
      }
    } finally {
      setIsStreaming(false)
      setLiveTools([])
      setLiveText('')
    }
  }

  const deleteConvMutation = useMutation({
    mutationFn: psApi.deleteConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ps-conversations'] })
      setSelectedConvId(null)
      setMessages([])
    },
  })

  const addApiMutation = useMutation({
    mutationFn: psApi.createApiEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ps-api-collection'] })
      enqueueSnackbar('API entry added', { variant: 'success' })
      setAddApiOpen(false)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteApiMutation = useMutation({
    mutationFn: psApi.deleteApiEntry,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ps-api-collection'] }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })


  const runWorkflowMutation = useMutation({
    mutationFn: async (id: number) => {
      setRunningId(id)
      return psApi.runWorkflow(id)
    },
    onSuccess: (r: any, id) => {
      setRunningId(null)
      enqueueSnackbar(`Workflow run complete — ${r.status}`, { variant: r.status === 'success' ? 'success' : 'warning' })
      queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
      if (selectedWorkflow?.id === id) queryClient.invalidateQueries({ queryKey: ['ps-workflow', id] })
    },
    onError: (e: Error) => {
      setRunningId(null)
      enqueueSnackbar(e.message, { variant: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => psApi.deleteWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
      if (selectedWorkflow?.id === deleteTarget?.id) setSelectedWorkflow(null)
      setDeleteTarget(null)
      enqueueSnackbar('Workflow deleted', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    const msg = input.trim()
    setInput('')
    // Show user message immediately
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg }])
    doStreamSend(msg)
  }

  const handleApprovalSubmit = () => {
    if (pendingApprovals.length === 0) return
    const approvals = pendingApprovals.map((p) => ({
      tool_call_id: p.tool_call_id,
      approved: approvalDecisions[p.tool_call_id] ?? false,
      api_id: p.input.api_id ?? undefined,
      payload: p.input.payload ?? undefined,
      sql: p.input.sql ?? undefined,
      rows_sql: p.input.rows_sql ?? undefined,
    }))
    const anyApproved = approvals.some((a) => a.approved)
    const label = anyApproved ? 'Approved — proceeding with API execution' : 'Rejected — no API calls will be made'
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: label }])
    doStreamSend('', approvals)
  }

  const tabs = [
    { key: 'chat', icon: <ChatOutlined />, label: 'AI Chat' },
    { key: 'workflows', icon: <BoltOutlined />, label: 'Workflows' },
  ] as const

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <Box sx={{ display: 'flex', gap: 1, px: 3, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={pageTab === t.key ? 'contained' : 'outlined'}
            startIcon={t.icon}
            size="small"
            onClick={() => setPageTab(t.key)}
            sx={{ borderRadius: 2 }}
          >
            {t.label}
            {t.key === 'workflows' && workflows.length > 0 && (
              <Chip
                label={workflows.length} size="small"
                sx={{ ml: 0.75, height: 18, fontSize: '0.688rem', bgcolor: pageTab === 'workflows' ? 'rgba(255,255,255,.25)' : undefined }}
              />
            )}
          </Button>
        ))}
      </Box>

      {/* ── CHAT ─────────────────────────────────────────── */}
      {pageTab === 'chat' && (
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Sidebar */}
          <Box
            ref={sidebarRef}
            sx={{
              width: sidebarWidth, flexShrink: 0,
              display: 'flex', flexDirection: 'column',
              bgcolor: 'background.paper',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* Configuration */}
            <Box sx={{ p: 2, pb: 1.5 }}>
              <Typography variant="overline" fontWeight={700} color="text.secondary" sx={{ fontSize: '0.688rem', letterSpacing: '0.1em' }}>
                Configuration
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {/* Connection is selected globally in the top bar */}
                <TextField
                  label="Model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Box>
            </Box>

            <Divider />

            {/* API Collection */}
            <Box sx={{ px: 1.5, py: 1 }}>
              <Accordion
                disableGutters
                sx={{
                  boxShadow: 'none', bgcolor: 'transparent',
                  '&:before': { display: 'none' },
                  '& .MuiAccordionSummary-root': { minHeight: 36, px: 0.5 },
                  '& .MuiAccordionSummary-content': { my: '4px !important' },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1 }}>
                    <ApiOutlined sx={{ fontSize: 15, color: 'primary.main' }} />
                    <Typography variant="caption" fontWeight={700} sx={{ letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary', fontSize: '0.688rem' }}>
                      API Collection
                    </Typography>
                    {apiCollection.length > 0 && (
                      <Chip label={apiCollection.length} size="small" sx={{ height: 16, fontSize: '0.625rem', ml: 0.5 }} />
                    )}
                    <Tooltip title="Full API management page">
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); navigate('/ps-support/api-collection') }}
                        sx={{ ml: 'auto', p: 0.25 }}
                      >
                        <ArrowForwardOutlined sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0.5, pt: 0, pb: 1 }}>
                  {apiCollection.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 1.5 }}>
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 1 }}>
                        No APIs added yet.
                      </Typography>
                      <Button
                        size="small" variant="contained" startIcon={<AddOutlined />}
                        onClick={() => setAddApiOpen(true)}
                        sx={{ fontSize: '0.72rem' }}
                      >
                        + Add API
                      </Button>
                    </Box>
                  ) : (
                    <>
                      <Box sx={{ mb: 1 }}>
                        {apiCollection.map((entry) => (
                          <ApiEntryRow
                            key={entry.id}
                            entry={entry}
                            onDelete={() => deleteApiMutation.mutate(entry.id)}
                          />
                        ))}
                      </Box>
                      <Button
                        size="small" variant="outlined" startIcon={<AddOutlined />}
                        onClick={() => setAddApiOpen(true)}
                        fullWidth sx={{ fontSize: '0.75rem' }}
                      >
                        Add API
                      </Button>
                    </>
                  )}
                </AccordionDetails>
              </Accordion>
            </Box>

            <Divider />

            {/* Conversations header — collapsible */}
            <Box
              sx={{
                px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'center',
                cursor: 'pointer', userSelect: 'none',
                '&:hover': { bgcolor: 'action.hover' },
              }}
              onClick={() => setConvsCollapsed((v) => !v)}
            >
              <ExpandMoreOutlined
                sx={{
                  fontSize: 16, mr: 0.5, color: 'text.secondary',
                  transform: convsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  transition: 'transform .2s',
                }}
              />
              <Typography variant="overline" fontWeight={700} color="text.secondary" sx={{ fontSize: '0.688rem', letterSpacing: '0.1em', flex: 1 }}>
                Conversations
                {conversations.length > 0 && (
                  <Chip label={conversations.length} size="small" sx={{ ml: 0.75, height: 16, fontSize: '0.625rem' }} />
                )}
              </Typography>
              <IconButton
                size="small"
                title="New conversation"
                onClick={(e) => { e.stopPropagation(); setSelectedConvId(null); setMessages([]); setInput('') }}
                sx={{ p: 0.25 }}
              >
                <AddOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>

            {!convsCollapsed && (
              <Box sx={{ flex: 1, overflow: 'auto', px: 1, pb: 1, minHeight: 0 }}>
                {conversations.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ px: 1, display: 'block', textAlign: 'center', py: 2 }}>
                    No conversations yet
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {(conversations as PsConversation[]).map((conv) => (
                      <ListItemButton
                        key={conv.id}
                        selected={selectedConvId === conv.id}
                        onClick={() => setSelectedConvId(conv.id)}
                        sx={{ borderRadius: 1.5, mb: 0.25, pr: 0.5 }}
                      >
                        <ListItemText
                          primary={
                            <Typography variant="caption" fontWeight={600} noWrap sx={{ display: 'block' }}>
                              {conv.title || 'Untitled'}
                            </Typography>
                          }
                          secondary={
                            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.625rem' }}>
                              {(conv.updated_at || conv.created_at)
                                ? new Date(conv.updated_at || conv.created_at).toLocaleDateString()
                                : '—'}
                            </Typography>
                          }
                        />
                        <Tooltip title="Export conversation">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              psApi.exportConversation(conv.id).then((data) => {
                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `conversation-${conv.id}.json`
                                a.click()
                                URL.revokeObjectURL(url)
                              })
                            }}
                            sx={{ opacity: 0, '.MuiListItemButton-root:hover &': { opacity: 0.6 }, '&:hover': { opacity: 1, color: 'primary.main' } }}
                          >
                            <DownloadOutlined sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete conversation">
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); deleteConvMutation.mutate(conv.id) }}
                            sx={{ opacity: 0, '.MuiListItemButton-root:hover &': { opacity: 0.6 }, '&:hover': { opacity: 1, color: 'error.main' } }}
                          >
                            <DeleteOutlined sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </Box>
            )}

            {/* ⚡ Create Workflow / Agent from Chat */}
            {selectedConvId && (
              <>
                <Divider />
                <Box sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<AutoFixHighOutlined sx={{ fontSize: '14px !important' }} />}
                    onClick={() => setCreateFromChatOpen(true)}
                    sx={{ fontSize: '0.75rem', justifyContent: 'flex-start' }}
                  >
                    ⚡ Save as Workflow
                  </Button>
                </Box>
              </>
            )}
          </Box>

          {/* Drag resize handle */}
          <Box
            onMouseDown={startResize}
            sx={{
              width: 5, flexShrink: 0, cursor: 'col-resize',
              borderRight: '1px solid', borderColor: 'divider',
              bgcolor: 'transparent',
              transition: 'background .15s',
              '&:hover': { bgcolor: 'primary.main', opacity: 0.35 },
            }}
          />

          {/* Chat main */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Messages */}
            <Box
              sx={{
                flex: 1, overflow: 'auto', p: 3,
                bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.15) : alpha('#f8fafc', 0.6),
              }}
            >
              {messages.length === 0 ? (
                <Box sx={{ textAlign: 'center', pt: 8, maxWidth: 520, mx: 'auto' }}>
                  <Avatar
                    sx={{
                      width: 72, height: 72, mx: 'auto', mb: 3,
                      background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
                      boxShadow: '0 12px 32px rgba(124,58,237,.3)',
                    }}
                  >
                    <SmartToyOutlined sx={{ fontSize: 36 }} />
                  </Avatar>
                  <Typography variant="h5" fontWeight={700} gutterBottom>
                    Production Support Assistant
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Ask questions about your data, request SQL queries, or get help with
                    production issues. Connect a data source above for richer context.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {[
                      'Show total sales by region',
                      'List top 10 customers by revenue',
                      'Count records updated today',
                      'Find any data quality issues',
                    ].map((s) => (
                      <Chip
                        key={s} label={s} variant="outlined" size="small"
                        onClick={() => setInput(s)}
                        sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                      />
                    ))}
                  </Box>
                </Box>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onRcaWorkflow={() => setCreateOpen(true)}
                  />
                ))
              )}
              {/* Approval cards — shown when AI wants to execute API calls */}
              {!isStreaming && pendingApprovals.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2 }}>
                  <Avatar sx={{ width: 32, height: 32, mt: 0.5, background: 'linear-gradient(135deg, #7c3aed, #2563eb)', flexShrink: 0 }}>
                    <SmartToyOutlined sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Box sx={{ flex: 1, maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      The AI wants to execute the following API action(s). Review and approve or reject each:
                    </Typography>
                    {pendingApprovals.map((p) => {
                      const isApproved = approvalDecisions[p.tool_call_id] ?? false
                      const toolLabel = p.tool === 'execute_api_for_rows' ? 'API Loop (one call per row)' : 'API Call'
                      const toolColor = p.tool === 'execute_api_for_rows' ? '#059669' : '#7c3aed'
                      return (
                        <Paper
                          key={p.tool_call_id}
                          variant="outlined"
                          sx={{
                            borderRadius: 2,
                            borderColor: isApproved ? '#059669' : alpha(toolColor, 0.4),
                            borderLeftWidth: 4,
                            borderLeftColor: toolColor,
                            overflow: 'hidden',
                          }}
                        >
                          <Box sx={{
                            px: 2, py: 1.25,
                            bgcolor: (t) => alpha(toolColor, t.palette.mode === 'dark' ? 0.12 : 0.05),
                            display: 'flex', alignItems: 'center', gap: 1.5,
                          }}>
                            <LinkOutlined sx={{ color: toolColor, fontSize: 18 }} />
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2" fontWeight={700}>{toolLabel}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                                {p.preview || (p.tool === 'execute_api_for_rows'
                                  ? `API #${p.input.api_id} — one call per SQL row`
                                  : `API #${p.input.api_id}`)}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.75 }}>
                              <Button
                                size="small"
                                variant={isApproved ? 'contained' : 'outlined'}
                                color="success"
                                onClick={() => setApprovalDecisions((prev) => ({ ...prev, [p.tool_call_id]: true }))}
                                sx={{ minWidth: 80, fontWeight: 700 }}
                              >
                                Approve
                              </Button>
                              <Button
                                size="small"
                                variant={!isApproved ? 'contained' : 'outlined'}
                                color="error"
                                onClick={() => setApprovalDecisions((prev) => ({ ...prev, [p.tool_call_id]: false }))}
                                sx={{ minWidth: 80, fontWeight: 700 }}
                              >
                                Reject
                              </Button>
                            </Box>
                          </Box>
                        </Paper>
                      )
                    })}
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={handleApprovalSubmit}
                        sx={{ fontWeight: 700 }}
                      >
                        Submit Decision
                      </Button>
                      <Button
                        variant="outlined"
                        color="inherit"
                        onClick={() => { setPendingApprovals([]); setApprovalDecisions({}) }}
                      >
                        Dismiss
                      </Button>
                    </Box>
                  </Box>
                </Box>
              )}

              {isStreaming && (
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2 }}>
                  <Avatar sx={{ width: 32, height: 32, mt: 0.5, background: 'linear-gradient(135deg, #7c3aed, #2563eb)', flexShrink: 0 }}>
                    <SmartToyOutlined sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Box sx={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1 }}>
                    {/* Live tool steps */}
                    {liveTools.length > 0 && (
                      <Box>
                        {liveTools.map((tc, i) => <ToolStep key={i} tc={tc} />)}
                      </Box>
                    )}
                    {/* Partial text or bouncing dots */}
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '4px 14px 14px 14px' }}>
                      {liveText ? (
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{liveText}</Typography>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                          {[0, 1, 2].map((i) => (
                            <Box
                              key={i}
                              sx={{
                                width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled',
                                animation: 'bounce 1.2s infinite', animationDelay: `${i * 0.2}s`,
                                '@keyframes bounce': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } },
                              }}
                            />
                          ))}
                        </Box>
                      )}
                    </Paper>
                  </Box>
                </Box>
              )}
              <div ref={messagesEndRef} />
            </Box>

            <Divider />

            {/* Input */}
            <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <Tooltip title="AI Debug Panel">
                <IconButton
                  size="small"
                  onClick={() => setDebugOpen((v) => !v)}
                  sx={{
                    borderRadius: 1.5, p: 0.75,
                    color: debugOpen ? 'primary.main' : 'text.disabled',
                    bgcolor: debugOpen ? alpha('#2563eb', 0.08) : 'transparent',
                    '&:hover': { bgcolor: alpha('#2563eb', 0.12) },
                  }}
                >
                  <BugReportOutlined sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <TextField
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                fullWidth multiline maxRows={4}
                placeholder="Ask a production support question… (Enter to send)"
                size="small"
              />
              {isStreaming ? (
                <Tooltip title="Stop generation">
                  <IconButton
                    color="error"
                    onClick={() => streamSendRef.current?.abort()}
                    sx={{
                      bgcolor: 'error.main', color: 'white', borderRadius: 2, p: 1.25,
                      '&:hover': { bgcolor: 'error.dark' },
                    }}
                  >
                    <StopOutlined />
                  </IconButton>
                </Tooltip>
              ) : (
                <IconButton
                  color="primary"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  sx={{
                    bgcolor: 'primary.main', color: 'white', borderRadius: 2, p: 1.25,
                    '&:hover': { bgcolor: 'primary.dark' },
                    '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                  }}
                >
                  <SendOutlined />
                </IconButton>
              )}
            </Box>
          </Box>
        </Box>
      )}

      {/* ── WORKFLOWS ─────────────────────────────────────── */}
      {pageTab === 'workflows' && (
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Workflow list */}
          <Box
            sx={{
              width: selectedWorkflow ? 380 : '100%',
              maxWidth: selectedWorkflow ? 380 : undefined,
              flexShrink: 0,
              display: 'flex', flexDirection: 'column',
              borderRight: selectedWorkflow ? '1px solid' : 'none',
              borderColor: 'divider',
              overflow: 'auto', p: 3,
              transition: 'width .3s ease',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h5" fontWeight={800}>Workflows</Typography>
                <Typography variant="body2" color="text.secondary">
                  Automate recurring tasks with multi-step workflows
                </Typography>
              </Box>
              <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreateOpen(true)}>
                Create Workflow
              </Button>
            </Box>

            {wfLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress /></Box>
            ) : workflows.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 8, textAlign: 'center', borderRadius: 3, borderStyle: 'dashed', borderColor: 'divider' }}>
                <BoltOutlined sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" fontWeight={700} color="text.secondary">No workflows yet</Typography>
                <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5, mb: 3 }}>
                  Create your first workflow to automate SQL queries, API calls, and emails
                </Typography>
                <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreateOpen(true)}>
                  Create First Workflow
                </Button>
              </Paper>
            ) : (
              <Grid container spacing={2}>
                {workflows.map((wf) => (
                  <Grid item xs={12} sm={selectedWorkflow ? 12 : 6} md={selectedWorkflow ? 12 : 4} key={wf.id}>
                    <WorkflowCard
                      wf={wf}
                      onSelect={() => setSelectedWorkflow(wf)}
                      onRun={() => runWorkflowMutation.mutate(wf.id)}
                      onEdit={() => setEditWorkflow(wf)}
                      isRunning={runningId === wf.id}
                    />
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>

          {/* Detail panel */}
          {selectedWorkflow && (
            <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: 'background.default' }}>
              <WorkflowDetail
                workflow={selectedWorkflow}
                onEdit={() => setEditWorkflow(selectedWorkflow)}
                onDelete={() => setDeleteTarget(selectedWorkflow)}
                onClose={() => setSelectedWorkflow(null)}
              />
            </Box>
          )}
        </Box>
      )}

      {/* AI Debug Drawer */}
      <PSAIDebugPanel
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        connId={connId}
        model={model}
        messages={messages}
      />

      {/* Dialogs */}
      <WorkflowDialog
        open={createOpen || Boolean(editWorkflow)}
        onClose={() => { setCreateOpen(false); setEditWorkflow(null) }}
        existing={editWorkflow}
        connId={connId !== '' ? (connId as number) : null}
        onCreated={(wf) => {
          setCreateOpen(false)
          queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
          setPageTab('workflows')
          setSelectedWorkflow(wf as any)
        }}
      />

      <AddApiDialog
        open={addApiOpen}
        onClose={() => setAddApiOpen(false)}
        onSave={(data) => addApiMutation.mutate(data)}
        saving={addApiMutation.isPending}
      />

      <CreateFromChatDialog
        open={createFromChatOpen}
        conversationId={selectedConvId}
        onClose={() => setCreateFromChatOpen(false)}
        onCreated={(wf) => {
          setCreateFromChatOpen(false)
          queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
          setPageTab('workflows')
          setSelectedWorkflow(wf)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Workflow"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        dangerous
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

    </Box>
  )
}
