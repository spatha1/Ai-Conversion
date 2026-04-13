import { useState, useRef, useId, useEffect } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, IconButton,
  TextField, Select, MenuItem, Checkbox,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Alert, Divider, alpha, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Tab, Tabs,
  Tooltip, Paper, Avatar, Badge, List, ListItem, ListItemButton,
  ListItemText, InputAdornment,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, SaveOutlined, SchemaOutlined,
  PlayArrowOutlined, DownloadOutlined, CheckCircleOutlineOutlined,
  ErrorOutlineOutlined, AutoAwesomeOutlined, SendOutlined,
  AttachFileOutlined, CloseOutlined,
  CheckOutlined, ApiOutlined, TextFieldsOutlined, PreviewOutlined,
  AccountTreeOutlined, SearchOutlined, AddCircleOutlineOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { validationApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { ValidationRule, ValidationError } from '@/types'

// ─── Types ────────────────────────────────────────────────────
interface AiRule {
  xml_path: string
  is_required: boolean
  data_type: string
  min_length?: number | null
  max_length?: number | null
  pattern?: string | null
  min_value?: number | null
  max_value?: number | null
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  rules?: AiRule[]
  file?: string
}

// ─── AI Dialog ────────────────────────────────────────────────
// ─── Path Picker Dialog ───────────────────────────────────────
interface XmlPath { path: string; sample: string; inferred_type: string }

function PathPickerDialog({
  open, onClose, connId, onAdd,
}: {
  open: boolean
  onClose: () => void
  connId: number
  onAdd: (paths: XmlPath[]) => void
}) {
  const [paths, setPaths] = useState<XmlPath[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { enqueueSnackbar } = useSnackbar()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSelected(new Set())
    setFilter('')
    validationApi.scanPaths(connId)
      .then((r) => {
        if (r.message && !r.paths.length) enqueueSnackbar(r.message, { variant: 'warning' })
        setPaths(r.paths)
      })
      .catch((e: Error) => enqueueSnackbar(e.message, { variant: 'error' }))
      .finally(() => setLoading(false))
  }, [open, connId])

  const filtered = paths.filter((p) =>
    !filter || p.path.toLowerCase().includes(filter.toLowerCase()),
  )

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  const handleAdd = () => {
    const chosen = paths.filter((p) => selected.has(p.path))
    onAdd(chosen)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <AccountTreeOutlined color="primary" />
        <Box flex={1}>
          <Typography variant="h6" fontWeight={700}>XML Paths from Generated Output</Typography>
          <Typography variant="caption" color="text.secondary">
            These are the exact element paths found in your generated XML — use them as rule paths.
          </Typography>
        </Box>
        <IconButton onClick={onClose}><CloseOutlined /></IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            fullWidth size="small"
            placeholder="Filter paths…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> }}
          />
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
            {filtered.length === 0 && (
              <ListItem><ListItemText primary="No paths found" secondary="Run Output generation first" /></ListItem>
            )}
            {filtered.map((p) => (
              <ListItemButton
                key={p.path}
                selected={selected.has(p.path)}
                onClick={() => toggle(p.path)}
                sx={{ py: 0.5 }}
              >
                <Checkbox size="small" checked={selected.has(p.path)} sx={{ mr: 1, p: 0 }} />
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {p.path}
                    </Typography>
                  }
                  secondary={
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}>
                      <Chip label={p.inferred_type} size="small" variant="outlined" sx={{ height: 16, fontSize: '0.6rem' }} />
                      {p.sample && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          e.g. "{p.sample}"
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 2, py: 1.5, justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" onClick={() => setSelected(new Set(paths.map((p) => p.path)))}>Select All</Button>
          <Button size="small" onClick={() => setSelected(new Set())}>Clear</Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={selected.size === 0}
            startIcon={<AddCircleOutlineOutlined />}>
            Add {selected.size} Rule{selected.size !== 1 ? 's' : ''}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}

function AiRulesDialog({
  open,
  onClose,
  connId,
  onApply,
}: {
  open: boolean
  onClose: () => void
  connId: number
  onApply: (rules: AiRule[]) => void
}) {
  const { enqueueSnackbar } = useSnackbar()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [inputTab, setInputTab] = useState(0)   // 0=text/file, 1=api-call
  const [sending, setSending] = useState(false)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // API call config
  const [apiUrl, setApiUrl] = useState('')
  const [apiMethod, setApiMethod] = useState('GET')
  const [apiHeaders, setApiHeaders] = useState('')
  const [apiBody, setApiBody] = useState('')
  const [apiPreview, setApiPreview] = useState<{ status: number; body_text: string; error: string | null } | null>(null)
  const [apiTesting, setApiTesting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Suggested rules aggregated from all assistant messages
  const allRules: AiRule[] = messages
    .filter((m) => m.role === 'assistant' && m.rules?.length)
    .flatMap((m) => m.rules!)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const testApi = async () => {
    if (!apiUrl.trim()) return
    setApiTesting(true)
    setApiPreview(null)
    try {
      let hdrs: Record<string, string> | undefined
      try { hdrs = apiHeaders ? JSON.parse(apiHeaders) : undefined } catch { hdrs = undefined }
      const res = await validationApi.apiFetch(connId, apiUrl, apiMethod, hdrs, apiBody || undefined)
      setApiPreview(res)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'API fetch failed'
      enqueueSnackbar(msg, { variant: 'error' })
    } finally {
      setApiTesting(false)
    }
  }

  const send = async () => {
    const hasText = input.trim()
    const hasFile = !!attachedFile
    const hasApi = inputTab === 1 && apiUrl.trim()
    if (!hasText && !hasFile && !hasApi) return

    let userContent = input.trim()
    if (hasFile && !userContent) userContent = `[Attached: ${attachedFile!.name}]`
    if (hasApi && !userContent) userContent = `[Fetch API: ${apiUrl}]`
    if (hasApi && userContent && !userContent.includes(apiUrl)) {
      userContent = `${userContent}\n[Also fetch API: ${apiUrl}]`
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: userContent,
      file: attachedFile?.name,
    }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setAttachedFile(null)
    setSending(true)
    try {
      const hist = newHistory
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }))
      const apiConfig = hasApi ? {
        url: apiUrl,
        method: apiMethod,
        headers: apiHeaders || undefined,
        body: apiBody || undefined,
      } : null
      const res = await validationApi.aiSuggest(
        connId,
        userMsg.content,
        hist,
        attachedFile || undefined,
        apiConfig,
      )
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.reply,
        rules: res.rules as unknown as AiRule[],
      }
      setMessages([...newHistory, assistantMsg])
      if (res.rules?.length) {
        // auto-select new rules
        const startIdx = allRules.length
        setSelected((prev) => {
          const next = new Set(prev)
          for (let i = 0; i < res.rules.length; i++) next.add(startIdx + i)
          return next
        })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI request failed'
      enqueueSnackbar(msg, { variant: 'error' })
      setMessages(newHistory) // remove user msg on error
    } finally {
      setSending(false)
    }
  }

  const toggleRule = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const handleApply = () => {
    const toApply = allRules.filter((_, i) => selected.has(i))
    if (!toApply.length) {
      enqueueSnackbar('Select at least one rule to apply', { variant: 'warning' })
      return
    }
    onApply(toApply)
    onClose()
    enqueueSnackbar(`${toApply.length} rule(s) added`, { variant: 'success' })
  }

  const handleClose = () => {
    setMessages([])
    setInput('')
    setAttachedFile(null)
    setSelected(new Set())
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '85vh', display: 'flex', flexDirection: 'column' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 18 }} />
        </Avatar>
        <Box>
          <Typography variant="h6" fontWeight={700} lineHeight={1.2}>AI Validation Assistant</Typography>
          <Typography variant="caption" color="text.secondary">
            Describe your data requirements or upload a spec doc — AI will suggest rules
          </Typography>
        </Box>
        <IconButton onClick={handleClose} sx={{ ml: 'auto' }}><CloseOutlined /></IconButton>
      </DialogTitle>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ── Chat panel ── */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid', borderColor: 'divider' }}>
          {/* Messages */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {messages.length === 0 && (
              <Box sx={{ textAlign: 'center', mt: 6, color: 'text.disabled' }}>
                <AutoAwesomeOutlined sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                <Typography variant="body2">
                  Tell me about your validation requirements.<br />
                  You can also attach a spec document or schema file.
                </Typography>
                <Box sx={{ mt: 3, display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                  {[
                    'Employee ID must be a number between 1 and 9999',
                    'Email field is required and must match email pattern',
                    'Date fields must be in YYYY-MM-DD format',
                    'Amount must be a positive decimal, max 2 decimal places',
                  ].map((hint) => (
                    <Chip
                      key={hint}
                      label={hint}
                      size="small"
                      variant="outlined"
                      clickable
                      onClick={() => setInput(hint)}
                      sx={{ fontSize: '0.7rem' }}
                    />
                  ))}
                </Box>
              </Box>
            )}
            {messages.map((msg, i) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 1 }}>
                {msg.role === 'assistant' && (
                  <Avatar sx={{ bgcolor: 'primary.main', width: 28, height: 28, mt: 0.5 }}>
                    <AutoAwesomeOutlined sx={{ fontSize: 16 }} />
                  </Avatar>
                )}
                <Box sx={{ maxWidth: '80%' }}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.5, borderRadius: 2,
                      bgcolor: msg.role === 'user'
                        ? (t) => t.palette.primary.main
                        : (t) => alpha(t.palette.action.hover, 0.6),
                      color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                      border: '1px solid',
                      borderColor: msg.role === 'user' ? 'primary.main' : 'divider',
                    }}
                  >
                    {msg.file && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, opacity: 0.8 }}>
                        <AttachFileOutlined sx={{ fontSize: 14 }} />
                        <Typography variant="caption">{msg.file}</Typography>
                      </Box>
                    )}
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {msg.content}
                    </Typography>
                  </Paper>
                  {msg.rules && msg.rules.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>
                        {msg.rules.length} rule(s) suggested — see right panel to select
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
            {sending && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Avatar sx={{ bgcolor: 'primary.main', width: 28, height: 28 }}>
                  <AutoAwesomeOutlined sx={{ fontSize: 16 }} />
                </Avatar>
                <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                  <CircularProgress size={14} sx={{ mr: 1 }} />
                  <Typography variant="caption" color="text.secondary">Analyzing…</Typography>
                </Paper>
              </Box>
            )}
            <div ref={bottomRef} />
          </Box>

          {/* Input bar */}
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
            <Tabs value={inputTab} onChange={(_, v) => setInputTab(v)} sx={{ px: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: '0.75rem' } }}>
              <Tab icon={<TextFieldsOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Text / File" />
              <Tab icon={<ApiOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="API Call" />
            </Tabs>
            <Divider />
            {inputTab === 0 && (
              <Box sx={{ p: 2 }}>
                {attachedFile && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, p: 1, borderRadius: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.08) }}>
                    <AttachFileOutlined fontSize="small" color="primary" />
                    <Typography variant="caption" flex={1}>{attachedFile.name}</Typography>
                    <IconButton size="small" onClick={() => setAttachedFile(null)}><CloseOutlined fontSize="small" /></IconButton>
                  </Box>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => setAttachedFile(e.target.files?.[0] ?? null)} />
                  <Tooltip title="Attach document (PDF, DOCX, XLSX, CSV, TXT…)">
                    <IconButton onClick={() => fileRef.current?.click()} color={attachedFile ? 'primary' : 'default'}>
                      <AttachFileOutlined />
                    </IconButton>
                  </Tooltip>
                  <TextField fullWidth multiline maxRows={4} size="small"
                    placeholder="Describe validation requirements or ask a question…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  />
                  <IconButton color="primary" onClick={send} disabled={sending || (!input.trim() && !attachedFile)}
                    sx={{ bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}>
                    <SendOutlined />
                  </IconButton>
                </Box>
              </Box>
            )}
            {inputTab === 1 && (
              <Box sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  <Select value={apiMethod} onChange={(e) => setApiMethod(e.target.value)} size="small" sx={{ width: 90 }}>
                    {['GET', 'POST', 'PUT', 'PATCH'].map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </Select>
                  <TextField fullWidth size="small" placeholder="https://api.example.com/schema" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} label="URL" />
                  <Tooltip title="Test API (preview response)">
                    <Button variant="outlined" size="small" startIcon={apiTesting ? <CircularProgress size={14} /> : <PreviewOutlined />}
                      onClick={testApi} disabled={!apiUrl.trim() || apiTesting} sx={{ whiteSpace: 'nowrap' }}>
                      Test
                    </Button>
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  <TextField fullWidth size="small" label='Headers (JSON, e.g. {"Authorization":"Bearer …"})' value={apiHeaders}
                    onChange={(e) => setApiHeaders(e.target.value)} sx={{ '& input': { fontFamily: 'monospace', fontSize: '0.75rem' } }} />
                  {apiMethod !== 'GET' && (
                    <TextField fullWidth size="small" label="Request body (JSON)" value={apiBody}
                      onChange={(e) => setApiBody(e.target.value)} sx={{ '& input': { fontFamily: 'monospace', fontSize: '0.75rem' } }} />
                  )}
                </Box>
                {apiPreview && (
                  <Box sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: apiPreview.error ? (t) => alpha(t.palette.error.main, 0.06) : (t) => alpha(t.palette.success.main, 0.06), border: '1px solid', borderColor: apiPreview.error ? 'error.light' : 'success.light' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Chip label={apiPreview.error ? 'Error' : `HTTP ${apiPreview.status}`} size="small" color={apiPreview.error ? 'error' : 'success'} />
                      {apiPreview.error && <Typography variant="caption" color="error">{apiPreview.error}</Typography>}
                    </Box>
                    {apiPreview.body_text && (
                      <Box sx={{ maxHeight: 80, overflow: 'auto', fontFamily: 'monospace', fontSize: '0.65rem', whiteSpace: 'pre-wrap', color: 'text.primary' }}>
                        {apiPreview.body_text.slice(0, 500)}
                      </Box>
                    )}
                  </Box>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField fullWidth size="small" multiline maxRows={2}
                    placeholder='Tell AI what to look for, e.g. "extract field types and required fields from this schema API"'
                    value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  />
                  <IconButton color="primary" onClick={send} disabled={sending || !apiUrl.trim()}
                    sx={{ bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}>
                    <SendOutlined />
                  </IconButton>
                </Box>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                  AI will call this API and analyze the response to suggest validation rules.
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* ── Rules preview panel ── */}
        <Box sx={{ width: 380, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Suggested Rules
              {allRules.length > 0 && (
                <Chip label={`${selected.size}/${allRules.length}`} size="small" color="primary" sx={{ ml: 1 }} />
              )}
            </Typography>
            {allRules.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" onClick={() => setSelected(new Set(allRules.map((_, i) => i)))}>All</Button>
                <Button size="small" onClick={() => setSelected(new Set())}>None</Button>
              </Box>
            )}
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {allRules.length === 0 ? (
              <Box sx={{ textAlign: 'center', mt: 4, color: 'text.disabled' }}>
                <Typography variant="caption">
                  Rules suggested by AI will appear here.<br />
                  Select rules to apply them to your table.
                </Typography>
              </Box>
            ) : (
              allRules.map((rule, i) => (
                <Paper
                  key={i}
                  variant="outlined"
                  onClick={() => toggleRule(i)}
                  sx={{
                    p: 1.5, mb: 1, borderRadius: 2, cursor: 'pointer',
                    borderColor: selected.has(i) ? 'primary.main' : 'divider',
                    bgcolor: selected.has(i) ? (t) => alpha(t.palette.primary.main, 0.05) : 'background.paper',
                    '&:hover': { borderColor: 'primary.main' },
                    transition: 'all 0.15s',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Checkbox
                      checked={selected.has(i)}
                      size="small"
                      sx={{ p: 0, mt: 0.2 }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRule(i)}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'monospace', display: 'block', wordBreak: 'break-all' }}>
                        {rule.xml_path}
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        <Chip label={rule.data_type || 'string'} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                        {rule.is_required && <Chip label="required" size="small" color="error" sx={{ fontSize: '0.65rem', height: 18 }} />}
                        {rule.min_length != null && <Chip label={`min:${rule.min_length}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />}
                        {rule.max_length != null && <Chip label={`max:${rule.max_length}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />}
                        {rule.pattern && <Chip label={`regex`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />}
                        {rule.min_value != null && <Chip label={`≥${rule.min_value}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />}
                        {rule.max_value != null && <Chip label={`≤${rule.max_value}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />}
                      </Box>
                      {rule.pattern && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.65rem', display: 'block', mt: 0.5, wordBreak: 'break-all' }}>
                          {rule.pattern}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </Paper>
              ))
            )}
          </Box>
          {allRules.length > 0 && (
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Button
                fullWidth
                variant="contained"
                startIcon={<CheckOutlined />}
                onClick={handleApply}
                disabled={selected.size === 0}
              >
                Apply {selected.size} Rule{selected.size !== 1 ? 's' : ''} to Table
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────
export default function ValidationTab() {
  const { enqueueSnackbar } = useSnackbar()
  const uid = useId()
  const qc = useQueryClient()
  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const prevConnIdRef = useRef<number | ''>(connId)

  const [rules, setRules] = useState<ValidationRule[]>([])
  const [xsdContent, setXsdContent] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [pathPickerOpen, setPathPickerOpen] = useState(false)
  const [pathMismatch, setPathMismatch] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean; total: number; failed: number;
    errors: ValidationError[]
  } | null>(null)

  const allowed = ['string', 'integer', 'decimal', 'date', 'boolean'] as const
  type DT = typeof allowed[number]

  // Shared sanitizer — strips fields irrelevant to the data type
  const sanitizeRules = (rs: ValidationRule[]) =>
    rs.map((r) => {
      const isNumeric = r.data_type === 'integer' || r.data_type === 'decimal'
      return {
        ...r,
        min_value: isNumeric ? r.min_value : undefined,
        max_value: isNumeric ? r.max_value : undefined,
        min_length: r.data_type === 'string' ? r.min_length : undefined,
        max_length: r.data_type === 'string' ? r.max_length : undefined,
        pattern:    r.data_type === 'string' ? r.pattern : undefined,
        enumeration: r.data_type === 'string' ? r.enumeration : undefined,
      }
    })

  // Reset local state when the active connection changes
  useEffect(() => {
    if (prevConnIdRef.current !== connId) {
      prevConnIdRef.current = connId
      setRules([])
      setXsdContent('')
      setValidationResult(null)
      setPathMismatch(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  // Scan the actual XML once when connection is selected — detect path mismatches
  const { data: scannedPaths } = useQuery({
    queryKey: ['scan-paths', connId],
    queryFn: () => validationApi.scanPaths(connId as number),
    enabled: Boolean(connId),
    retry: false,
    staleTime: 30_000,
  })

  const { data: savedRules } = useQuery({
    queryKey: ['validation-rules', connId],
    queryFn: () => validationApi.getRules(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })

  // When both savedRules and scannedPaths are ready, auto-correct any wrong paths
  useEffect(() => {
    if (!savedRules?.length || rules.length > 0) return
    // If no scanned paths yet, just load as-is
    if (!scannedPaths?.paths.length) {
      setRules(savedRules.map((r, i) => ({ ...r, id: `saved-${i}` })))
      return
    }
    const validPaths = new Set(scannedPaths.paths.map((p) => p.path))
    // Build leaf → full path map for auto-correction  e.g. "EmpNo" → "DepartmentConversion...Employee.EmpNo"
    const leafToPath = new Map<string, string>()
    for (const p of scannedPaths.paths) {
      const leaf = p.path.split('.').pop()!.toLowerCase()
      leafToPath.set(leaf, p.path)
    }

    let fixed = 0
    const corrected = savedRules.map((r, i) => {
      if (!r.xml_path || validPaths.has(r.xml_path)) {
        return { ...r, id: `saved-${i}` }
      }
      // Try to find the correct path by matching the leaf name
      const savedLeaf = r.xml_path.split('.').pop()!.toLowerCase()
      const correctPath = leafToPath.get(savedLeaf)
      if (correctPath) {
        fixed++
        return { ...r, id: `saved-${i}`, xml_path: correctPath }
      }
      return { ...r, id: `saved-${i}` }
    })

    setRules(corrected)

    if (fixed > 0) {
      // Auto-save the corrected paths silently
      const sanitized = sanitizeRules(corrected)
      validationApi.saveRules(connId as number, sanitized)
        .then(() => {
          qc.invalidateQueries({ queryKey: ['validation-rules', connId] })
          enqueueSnackbar(`Auto-corrected ${fixed} rule path(s) to match generated XML`, { variant: 'info' })
        })
        .catch(() => {/* silent */})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRules, scannedPaths])

  // Detect remaining mismatches (paths that couldn't be auto-corrected)
  useEffect(() => {
    if (!scannedPaths?.paths.length || !rules.length) { setPathMismatch(false); return }
    const validPaths = new Set(scannedPaths.paths.map((p) => p.path))
    const hasMismatch = rules.some((r) => r.xml_path && !validPaths.has(r.xml_path))
    setPathMismatch(hasMismatch)
  }, [rules, scannedPaths])

  const importPaths = useMutation({
    mutationFn: () => validationApi.scanPaths(connId as number),
    onSuccess: async (result) => {
      if (result.message && !result.paths.length) {
        enqueueSnackbar(result.message, { variant: 'warning' })
        return
      }
      // Match existing rules to new paths by leaf name — carry over all user constraints
      const existingByPath = Object.fromEntries(rules.map((r) => [r.xml_path, r]))
      const existingByLeaf = Object.fromEntries(
        rules.map((r) => [r.xml_path.split('.').pop()!.toLowerCase(), r])
      )
      const newRules: ValidationRule[] = result.paths.map((p, i) => {
        const leaf = p.path.split('.').pop()!.toLowerCase()
        const existing = existingByPath[p.path] ?? existingByLeaf[leaf]
        return existing
          ? { ...existing, id: existing.id ?? `${uid}-${i}`, xml_path: p.path }
          : {
              id: `${uid}-${i}`,
              xml_path: p.path,
              is_required: false,
              data_type: (allowed.includes(p.inferred_type as DT) ? p.inferred_type : 'string') as DT,
            }
      })
      setRules(newRules)
      setPathMismatch(false)
      try {
        await validationApi.saveRules(connId as number, sanitizeRules(newRules))
        qc.invalidateQueries({ queryKey: ['validation-rules', connId] })
        enqueueSnackbar(`${result.paths.length} paths imported and saved`, { variant: 'success' })
      } catch {
        enqueueSnackbar('Paths imported — click Save Rules to persist', { variant: 'info' })
      }
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMutation = useMutation({
    mutationFn: () => validationApi.saveRules(connId as number, sanitizeRules(rules)),
    onSuccess: () => {
      enqueueSnackbar('Rules saved', { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['validation-rules', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const genXsdMutation = useMutation({
    mutationFn: () => validationApi.generateXsd(connId as number),
    onSuccess: (r) => {
      setXsdContent(r.xsd)
      enqueueSnackbar('XSD generated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const runValidation = useMutation({
    mutationFn: () => validationApi.runValidation(connId as number),
    onSuccess: (r) => setValidationResult(r),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const addRow = () => {
    setRules([...rules, { id: `${uid}-${Date.now()}`, xml_path: '', data_type: 'string' }])
  }

  const updateRule = (id: string, field: keyof ValidationRule, value: unknown) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const deleteRule = (id: string) => setRules(rules.filter((r) => r.id !== id))

  const downloadXsd = () => {
    if (!xsdContent) return
    const blob = new Blob([xsdContent], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'schema.xsd'; a.click()
    URL.revokeObjectURL(url)
  }

  const handlePathPickerAdd = (xmlPaths: XmlPath[]) => {
    const allowed = ['string', 'integer', 'decimal', 'date', 'boolean'] as const
    type DT = typeof allowed[number]
    const newRules: ValidationRule[] = xmlPaths.map((p, i) => ({
      id: `${uid}-scan-${Date.now()}-${i}`,
      xml_path: p.path,
      is_required: false,
      data_type: (allowed.includes(p.inferred_type as DT) ? p.inferred_type : 'string') as DT,
    }))
    // Skip paths already in rules
    const existing = new Set(rules.map((r) => r.xml_path))
    const fresh = newRules.filter((r) => !existing.has(r.xml_path))
    setRules((prev) => [...prev, ...fresh])
    enqueueSnackbar(`${fresh.length} path(s) added`, { variant: 'success' })
  }

  const handleAiApply = (aiRules: AiRule[]) => {
    const allowed = ['string', 'integer', 'decimal', 'date', 'boolean'] as const
    type DT = typeof allowed[number]

    // Build leaf → full path map from scanned paths for auto-correction
    const leafToPath = new Map<string, string>()
    const validPaths = new Set<string>()
    if (scannedPaths?.paths?.length) {
      for (const p of scannedPaths.paths) {
        validPaths.add(p.path)
        const leaf = p.path.split('.').pop()!.toLowerCase()
        leafToPath.set(leaf, p.path)
      }
    }

    const newRules: ValidationRule[] = aiRules.map((r, i) => {
      let xmlPath = r.xml_path
      // Auto-correct path if it doesn't match a known valid path
      if (xmlPath && validPaths.size > 0 && !validPaths.has(xmlPath)) {
        const leaf = xmlPath.split('.').pop()!.toLowerCase()
        const corrected = leafToPath.get(leaf)
        if (corrected) xmlPath = corrected
      }
      return {
        id: `${uid}-ai-${Date.now()}-${i}`,
        xml_path: xmlPath,
        is_required: r.is_required,
        data_type: (allowed.includes(r.data_type as DT) ? r.data_type : 'string') as DT,
        min_length: r.min_length ?? undefined,
        max_length: r.max_length ?? undefined,
        pattern: r.pattern ?? undefined,
        min_value: r.min_value ?? undefined,
        max_value: r.max_value ?? undefined,
      }
    })
    setRules((prev) => [...prev, ...newRules])
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Toolbar */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<SchemaOutlined />}
              onClick={() => importPaths.mutate()}
              disabled={!connId || importPaths.isPending}
            >
              Import Paths from Template
            </Button>
            <Button
              variant="outlined"
              startIcon={<AddOutlined />}
              onClick={addRow}
            >
              Add Rule
            </Button>
            <Badge badgeContent="AI" color="primary">
              <Button
                variant="outlined"
                startIcon={<AutoAwesomeOutlined />}
                onClick={() => setAiOpen(true)}
                disabled={!connId}
                sx={{
                  borderColor: 'primary.main',
                  color: 'primary.main',
                  '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
                }}
              >
                AI Suggest Rules
              </Button>
            </Badge>
            <Button
              variant="contained"
              startIcon={<SaveOutlined />}
              onClick={() => saveMutation.mutate()}
              disabled={!connId || saveMutation.isPending}
              sx={{ ml: 'auto' }}
            >
              Save Rules
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Path mismatch warning */}
      {pathMismatch && (
        <Alert
          severity="warning"
          sx={{ mb: 2, borderRadius: 2 }}
          action={
            <Button
              size="small"
              color="warning"
              variant="contained"
              startIcon={importPaths.isPending ? <CircularProgress size={14} color="inherit" /> : <SchemaOutlined />}
              onClick={() => importPaths.mutate()}
              disabled={importPaths.isPending}
            >
              Fix Paths Now
            </Button>
          }
        >
          <Typography variant="body2" fontWeight={600}>Rule paths don't match your generated XML</Typography>
          <Typography variant="caption">
            Your saved rules use paths that don't exist in the generated XML (e.g. <code>Root.Employee.EName</code> instead of the real element name).
            Click <strong>Fix Paths Now</strong> or <strong>Import Paths from Template</strong> to replace them with the correct paths.
          </Typography>
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Left: Rule editor */}
        <Grid item xs={12} xl={8}>
          <Card>
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="h6" fontWeight={700}>
                  Validation Rules
                  {rules.length > 0 && <Chip label={rules.length} size="small" sx={{ ml: 1 }} />}
                </Typography>
              </Box>
              <Divider />
              <Box sx={{ overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.7rem', py: 1 } }}>
                      <TableCell>XML Path <Typography variant="caption" color="text.disabled">(dot or /slash)</Typography></TableCell>
                      <TableCell align="center">Req</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Min Len</TableCell>
                      <TableCell>Max Len</TableCell>
                      <TableCell>Pattern (regex)</TableCell>
                      <TableCell>Allowed Values <Typography variant="caption" color="text.disabled">(comma sep)</Typography></TableCell>
                      <TableCell>Min Val</TableCell>
                      <TableCell>Max Val</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rules.map((rule) => {
                      const validPaths = scannedPaths?.paths ? new Set(scannedPaths.paths.map((p) => p.path)) : null
                      const badPath = validPaths && rule.xml_path && !validPaths.has(rule.xml_path)
                      return (
                      <TableRow key={rule.id} hover
                        sx={badPath ? { bgcolor: (t) => alpha(t.palette.warning.main, 0.08) } : undefined}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {badPath && (
                              <Tooltip title="Path not found in generated XML — click 'Fix Paths Now' to correct">
                                <ErrorOutlineOutlined color="warning" sx={{ fontSize: 16, flexShrink: 0 }} />
                              </Tooltip>
                            )}
                            <TextField
                              value={rule.xml_path}
                              onChange={(e) => updateRule(rule.id!, 'xml_path', e.target.value)}
                              size="small" variant="standard"
                              placeholder="e.g. Root.Employee.Name"
                              sx={{ minWidth: 180, '& input': { fontFamily: 'monospace', fontSize: '0.75rem', color: badPath ? 'warning.dark' : undefined } }}
                            />
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={rule.is_required ?? false}
                            onChange={(e) => updateRule(rule.id!, 'is_required', e.target.checked)}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={rule.data_type ?? 'string'}
                            onChange={(e) => updateRule(rule.id!, 'data_type', e.target.value)}
                            size="small" variant="standard" sx={{ minWidth: 90 }}
                          >
                            <MenuItem value="string">string</MenuItem>
                            <MenuItem value="integer">integer</MenuItem>
                            <MenuItem value="decimal">decimal</MenuItem>
                            <MenuItem value="date">date</MenuItem>
                            <MenuItem value="boolean">boolean</MenuItem>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {rule.data_type === 'string' ? (
                            <TextField
                              type="number" value={rule.min_length ?? ''}
                              onChange={(e) => updateRule(rule.id!, 'min_length', e.target.value === '' ? undefined : Number(e.target.value))}
                              size="small" variant="standard" sx={{ width: 60 }}
                            />
                          ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                        <TableCell>
                          {rule.data_type === 'string' ? (
                            <TextField
                              type="number" value={rule.max_length ?? ''}
                              onChange={(e) => updateRule(rule.id!, 'max_length', e.target.value === '' ? undefined : Number(e.target.value))}
                              size="small" variant="standard" sx={{ width: 60 }}
                            />
                          ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                        <TableCell>
                          <TextField
                            value={rule.pattern ?? ''}
                            onChange={(e) => updateRule(rule.id!, 'pattern', e.target.value)}
                            size="small" variant="standard"
                            placeholder="^[A-Z]+$"
                            sx={{ minWidth: 110, '& input': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <Tooltip title="Comma-separated list of allowed values (enumeration). Only applies to string type.">
                            <TextField
                              value={rule.enumeration ?? ''}
                              onChange={(e) => updateRule(rule.id!, 'enumeration', e.target.value)}
                              size="small" variant="standard"
                              placeholder="VAL1,VAL2,VAL3"
                              sx={{ minWidth: 130, '& input': { fontSize: '0.75rem' } }}
                            />
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {(rule.data_type === 'integer' || rule.data_type === 'decimal') ? (
                            <TextField
                              type="number" value={rule.min_value ?? ''}
                              onChange={(e) => updateRule(rule.id!, 'min_value', e.target.value === '' ? undefined : Number(e.target.value))}
                              size="small" variant="standard" sx={{ width: 60 }}
                            />
                          ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                        <TableCell>
                          {(rule.data_type === 'integer' || rule.data_type === 'decimal') ? (
                            <TextField
                              type="number" value={rule.max_value ?? ''}
                              onChange={(e) => updateRule(rule.id!, 'max_value', e.target.value === '' ? undefined : Number(e.target.value))}
                              size="small" variant="standard" sx={{ width: 60 }}
                            />
                          ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" color="error" onClick={() => deleteRule(rule.id!)}>
                            <DeleteOutlined fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      )
                    })}
                    {rules.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} align="center" sx={{ py: 6, color: 'text.disabled' }}>
                          No validation rules. Import paths from template, add rows manually, or use AI Suggest.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: XSD + Results */}
        <Grid item xs={12} xl={4}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* XSD Card */}
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={700} gutterBottom>
                  XSD Schema
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                  <Button
                    variant="outlined"
                    startIcon={<SchemaOutlined />}
                    onClick={() => genXsdMutation.mutate()}
                    disabled={!connId || genXsdMutation.isPending}
                    fullWidth
                  >
                    Generate XSD
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadOutlined />}
                    onClick={downloadXsd}
                    disabled={!xsdContent}
                  >
                    Download
                  </Button>
                </Box>
                {xsdContent && (
                  <Box
                    sx={{
                      p: 1.5, borderRadius: 2, maxHeight: 200, overflow: 'auto',
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
                      border: '1px solid', borderColor: 'divider',
                      fontFamily: 'monospace', fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {xsdContent}
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Validation Results */}
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="h6" fontWeight={700}>Validation Results</Typography>
                  {validationResult && (
                    <Chip
                      label={validationResult.valid ? 'All Valid' : `${validationResult.failed} Errors`}
                      color={validationResult.valid ? 'success' : 'error'}
                      size="small"
                      icon={validationResult.valid ? <CheckCircleOutlineOutlined /> : <ErrorOutlineOutlined />}
                    />
                  )}
                </Box>
                <Button
                  variant="contained"
                  fullWidth
                  startIcon={runValidation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
                  onClick={() => runValidation.mutate()}
                  disabled={!connId || runValidation.isPending}
                  color={validationResult?.valid ? 'success' : 'primary'}
                >
                  Run Validation
                </Button>
                {validationResult && validationResult.errors.length > 0 && (
                  <Box sx={{ mt: 2, maxHeight: 300, overflow: 'auto' }}>
                    {validationResult.errors.map((err, i) => {
                      const isNotFound = err.actual === '(path not found in XML)'
                      return (
                      <Alert key={i} severity={isNotFound ? 'warning' : 'error'} sx={{ mb: 1, py: 0.5, borderRadius: 2, '& .MuiAlert-message': { width: '100%' } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Typography variant="caption" fontWeight={700} color="error.dark">
                            {err.identifier}
                          </Typography>
                          {err.path && (
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: 'text.secondary', ml: 1 }}>
                              {err.path.split('/').pop() || err.path}
                            </Typography>
                          )}
                        </Box>
                        <Typography variant="caption" display="block" sx={{ mt: 0.25 }}>
                          {err.message}
                        </Typography>
                        {(err.actual || err.expected) && (
                          <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
                            {err.actual && (
                              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>Got:</Typography>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', bgcolor: (t) => alpha(t.palette.error.main, 0.1), px: 0.5, borderRadius: 0.5 }}>
                                  {err.actual}
                                </Typography>
                              </Box>
                            )}
                            {err.expected && (
                              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>Expected:</Typography>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', bgcolor: (t) => alpha(t.palette.success.main, 0.1), px: 0.5, borderRadius: 0.5 }}>
                                  {err.expected}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        )}
                      </Alert>
                      )})}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>

      {/* AI Dialog */}
      {connId && (
        <AiRulesDialog
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          connId={connId as number}
          onApply={handleAiApply}
        />
      )}

      {/* Path Picker Dialog */}
      {connId && (
        <PathPickerDialog
          open={pathPickerOpen}
          onClose={() => setPathPickerOpen(false)}
          connId={connId as number}
          onAdd={handlePathPickerAdd}
        />
      )}
    </Box>
  )
}
