import { useState, useRef, useEffect } from 'react'
import {
  Box, Card, CardContent, Typography, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Chip, IconButton, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert, Divider, Badge, Collapse,
  alpha, List, ListItem, ListItemText, Tabs, Tab,
} from '@mui/material'
import {
  SendOutlined, SmartToyOutlined, SaveOutlined, ExpandMoreOutlined,
  ExpandLessOutlined, VisibilityOutlined, VisibilityOffOutlined,
  AttachFileOutlined, CloseOutlined, RefreshOutlined,
  CheckCircleOutlined, ErrorOutlined, HelpOutlineOutlined,
  PlayArrowOutlined, ReplayOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { dispatchApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { ApiDispatchConfig, ApiDispatchLog, XmlDispatchRow } from '@/api'

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_CHIP = (s?: string | null) => {
  if (!s) return <Chip label="Not sent" size="small" variant="outlined" sx={{ color: 'text.disabled' }} />
  if (s === 'success') return <Chip label="Success" size="small" color="success" icon={<CheckCircleOutlined />} />
  if (s === 'fail')    return <Chip label="Failed"  size="small" color="error"   icon={<ErrorOutlined />} />
  if (s === 'running') return <Chip label="Running" size="small" color="info"    icon={<CircularProgress size={12} />} />
  return <Chip label={s} size="small" variant="outlined" />
}

const VALIDATION_CHIP = (s?: string | null) => {
  if (!s)           return <Chip label="Not run"  size="small" variant="outlined" sx={{ color: 'text.disabled' }} />
  if (s === 'pass') return <Chip label="Pass" size="small" color="success" variant="outlined" />
  if (s === 'fail') return <Chip label="Fail" size="small" color="error"   variant="outlined" />
  return <Chip label={s} size="small" variant="outlined" />
}

const AUTH_TYPES = ['none', 'bearer', 'apikey', 'basic', 'oauth2']
const METHODS    = ['POST', 'PUT', 'PATCH']
const CTYPES     = ['application/xml', 'text/xml', 'application/json']

// ─── AI Configure Dialog ──────────────────────────────────────────────────────

interface AiCfgDialogProps {
  open: boolean
  connId: number
  onApply: (cfg: Partial<ApiDispatchConfig>) => void
  onClose: () => void
}

function AiCfgDialog({ open, connId, onApply, onClose }: AiCfgDialogProps) {
  const [tab, setTab] = useState(0)
  const [input, setInput] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [history, setHistory] = useState<Array<{ role: string; content: string }>>([])
  const [suggested, setSuggested] = useState<Partial<ApiDispatchConfig> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [history])

  const askMut = useMutation({
    mutationFn: () => dispatchApi.aiConfigure(connId, input, history, file),
    onSuccess: (r) => {
      const newHist = [
        ...history,
        { role: 'user', content: input + (file ? ` [${file.name}]` : '') },
        { role: 'assistant', content: r.reply },
      ]
      setHistory(newHist)
      setInput('')
      setFile(null)
      if (r.config && Object.keys(r.config).length > 0) setSuggested(r.config)
    },
    onError: (e: Error) => alert(e.message),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '80vh', display: 'flex', flexDirection: 'column' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <SmartToyOutlined color="primary" />
        AI API Configuration Assistant
        <IconButton sx={{ ml: 'auto' }} onClick={onClose}><CloseOutlined /></IconButton>
      </DialogTitle>
      <Divider />

      <DialogContent sx={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden', p: 2 }}>
        {/* Left — Chat */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box ref={chatRef} sx={{ flex: 1, overflowY: 'auto', pr: 1, mb: 2 }}>
            {history.length === 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Describe the API you want to connect to — paste documentation, upload a spec file,
                or just describe the endpoint URL and auth method. I'll configure it for you.
              </Alert>
            )}
            {history.map((h, i) => (
              <Box key={i} sx={{
                mb: 1.5,
                display: 'flex',
                justifyContent: h.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <Box sx={{
                  maxWidth: '85%', px: 2, py: 1, borderRadius: 2,
                  bgcolor: h.role === 'user'
                    ? (t) => alpha(t.palette.primary.main, 0.12)
                    : (t) => alpha(t.palette.grey[500], 0.08),
                  fontSize: '0.875rem', whiteSpace: 'pre-wrap',
                }}>
                  {h.content}
                </Box>
              </Box>
            ))}
            {askMut.isPending && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'text.secondary' }}>
                <CircularProgress size={14} /> Thinking…
              </Box>
            )}
          </Box>

          {/* Input area */}
          <Box>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
              <Tab label="Text" sx={{ minHeight: 36, textTransform: 'none' }} />
              <Tab label="File" sx={{ minHeight: 36, textTransform: 'none' }} />
            </Tabs>
            {tab === 0 && (
              <TextField
                fullWidth multiline rows={3}
                placeholder="Describe the API endpoint, auth method, or paste sample docs…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey && input.trim()) askMut.mutate()
                }}
              />
            )}
            {tab === 1 && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <input type="file" ref={fileRef} style={{ display: 'none' }}
                  accept=".pdf,.docx,.txt,.md,.json,.yaml,.yml,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <Button variant="outlined" startIcon={<AttachFileOutlined />}
                  onClick={() => fileRef.current?.click()}>
                  {file ? file.name : 'Choose File'}
                </Button>
                {file && <IconButton size="small" onClick={() => setFile(null)}><CloseOutlined fontSize="small" /></IconButton>}
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <Button
                variant="contained" fullWidth
                disabled={askMut.isPending || (!input.trim() && !file)}
                onClick={() => askMut.mutate()}
              >
                {askMut.isPending ? 'Asking…' : 'Send (Ctrl+Enter)'}
              </Button>
            </Box>
          </Box>
        </Box>

        <Divider orientation="vertical" flexItem />

        {/* Right — Suggested Config */}
        <Box sx={{ width: 300, overflowY: 'auto' }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Suggested Configuration
          </Typography>
          {!suggested ? (
            <Typography variant="body2" color="text.secondary">
              Chat with the assistant to get a configuration suggestion.
            </Typography>
          ) : (
            <List dense disablePadding>
              {[
                ['URL',          suggested.endpoint_url     ?? '—'],
                ['Method',       suggested.method           ?? '—'],
                ['Content-Type', suggested.content_type     ?? '—'],
                ['Auth Type',    suggested.auth_type        ?? '—'],
                ['Auth Value',   suggested.auth_value ? '••••••' : '—'],
                ['Auth Header',  suggested.auth_header_name ?? '—'],
                ['Extra Headers',suggested.extra_headers    ?? '—'],
              ].map(([label, val]) => (
                <ListItem key={label} disablePadding sx={{ py: 0.5 }}>
                  <ListItemText
                    primary={label}
                    secondary={String(val)}
                    primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                    secondaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!suggested}
          onClick={() => { if (suggested) { onApply(suggested); onClose() } }}
        >
          Apply Configuration
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Payload preview dialog ───────────────────────────────────────────────────

function PayloadDialog({ open, title, content, status, timeMs, onClose }: {
  open: boolean; title: string; content: string; status?: number; timeMs?: number; onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {title}
        {status !== undefined && (
          <Chip label={`HTTP ${status}`} size="small"
            color={status > 0 && status < 300 ? 'success' : 'error'} sx={{ ml: 1 }} />
        )}
        {timeMs !== undefined && timeMs > 0 && (
          <Chip label={`${timeMs}ms`} size="small" variant="outlined" />
        )}
        <IconButton sx={{ ml: 'auto' }} onClick={onClose}><CloseOutlined /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{
          p: 2, borderRadius: 1, bgcolor: (t) => t.palette.mode === 'dark' ? '#0f172a' : '#f8fafc',
          border: '1px solid', borderColor: 'divider',
          fontFamily: 'monospace', fontSize: '0.8rem',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 500, overflow: 'auto',
        }}>
          {content || '(empty)'}
        </Box>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SendToApiTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const [configOpen, setConfigOpen] = useState(true)
  const [aiOpen, setAiOpen] = useState(false)
  const [showAuthVal, setShowAuthVal] = useState(false)
  const [payloadDlg, setPayloadDlg] = useState<{
    open: boolean; title: string; content: string; status?: number; timeMs?: number
  }>({ open: false, title: '', content: '' })

  // Local dispatch state overrides (optimistic updates while sending)
  const [localLogs, setLocalLogs] = useState<Record<number, ApiDispatchLog>>({})
  const [sendingIds, setSendingIds] = useState<Set<number>>(new Set())

  // Config form state
  const [cfg, setCfg] = useState<ApiDispatchConfig>({
    method: 'POST', content_type: 'application/xml', auth_type: 'none',
  })

  // Load saved config when connection changes
  const { data: savedCfg } = useQuery({
    queryKey: ['dispatch-config', connId],
    queryFn: () => dispatchApi.getConfig(connId as number),
    enabled: Boolean(connId),
    onSuccess: (d) => setCfg({ ...d, auth_value: '' }),  // don't populate auth_value for security
  } as Parameters<typeof useQuery>[0])

  // Load XMLs list
  const { data: xmlRows = [], refetch: refetchXmls, isFetching: xmlsFetching } = useQuery({
    queryKey: ['dispatch-xmls', connId],
    queryFn: () => dispatchApi.listXmls(connId as number),
    enabled: Boolean(connId),
    refetchInterval: false,
  })

  const saveCfgMut = useMutation({
    mutationFn: () => dispatchApi.saveConfig(connId as number, cfg),
    onSuccess: () => {
      enqueueSnackbar('API configuration saved', { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['dispatch-config', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const sendOneMut = useMutation({
    mutationFn: (xmlId: number) => {
      setSendingIds((prev) => new Set([...prev, xmlId]))
      return dispatchApi.sendOne(connId as number, xmlId)
    },
    onSuccess: (log, xmlId) => {
      setSendingIds((prev) => { const s = new Set(prev); s.delete(xmlId); return s })
      setLocalLogs((prev) => ({ ...prev, [xmlId]: log }))
      enqueueSnackbar(
        log.status === 'success'
          ? `Sent ${log.identifier_value} — HTTP ${log.response_status}`
          : `Failed: ${log.error_message}`,
        { variant: log.status === 'success' ? 'success' : 'error' },
      )
      refetchXmls()
    },
    onError: (e: Error, xmlId) => {
      setSendingIds((prev) => { const s = new Set(prev); s.delete(xmlId); return s })
      enqueueSnackbar(e.message, { variant: 'error' })
    },
  })

  const sendAllMut = useMutation({
    mutationFn: () => dispatchApi.sendAll(connId as number),
    onSuccess: (r) => {
      enqueueSnackbar(`Dispatched ${r.sent}/${r.total} — ${r.failed} failed`, {
        variant: r.failed === 0 ? 'success' : 'warning',
      })
      refetchXmls()
      qc.invalidateQueries({ queryKey: ['dispatch-xmls', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const handleAiApply = (aiCfg: Partial<ApiDispatchConfig>) => {
    setCfg((prev) => ({
      ...prev,
      endpoint_url:     aiCfg.endpoint_url     ?? prev.endpoint_url,
      method:           aiCfg.method           ?? prev.method,
      content_type:     aiCfg.content_type     ?? prev.content_type,
      auth_type:        aiCfg.auth_type        ?? prev.auth_type,
      auth_value:       aiCfg.auth_value       ?? prev.auth_value,
      auth_header_name: aiCfg.auth_header_name ?? prev.auth_header_name,
      extra_headers:    aiCfg.extra_headers    ?? prev.extra_headers,
    }))
    enqueueSnackbar('AI configuration applied — review and save', { variant: 'info' })
    setConfigOpen(true)
  }

  const validatedCount = xmlRows.filter((r) => r.validation_status === 'pass').length
  const successCount   = xmlRows.filter((r) => (localLogs[r.xml_id]?.status ?? r.dispatch_status) === 'success').length
  const failCount      = xmlRows.filter((r) => (localLogs[r.xml_id]?.status ?? r.dispatch_status) === 'fail').length

  const openPayload = (title: string, content: string, status?: number, timeMs?: number) =>
    setPayloadDlg({ open: true, title, content, status, timeMs })

  return (
    <Box sx={{ p: 3 }}>
      {/* Top bar */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={<SmartToyOutlined />}
          onClick={() => setAiOpen(true)} disabled={!connId}>
          AI Configure
        </Button>
        <Box sx={{ flex: 1 }} />
        {xmlRows.length > 0 && (
          <>
            <Chip label={`${xmlRows.length} XMLs`} variant="outlined" size="small" />
            <Chip label={`${validatedCount} validated`} color="success" variant="outlined" size="small" />
            {successCount > 0 && <Chip label={`${successCount} sent`} color="primary" size="small" />}
            {failCount    > 0 && <Chip label={`${failCount} failed`} color="error" size="small" />}
          </>
        )}
        <Button
          variant="contained"
          startIcon={sendAllMut.isPending ? <CircularProgress size={16} color="inherit" /> : <SendOutlined />}
          onClick={() => sendAllMut.mutate()}
          disabled={!connId || !cfg.endpoint_url || validatedCount === 0 || sendAllMut.isPending}
          color="primary"
        >
          {sendAllMut.isPending ? 'Sending…' : `Send All Validated (${validatedCount})`}
        </Button>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={() => refetchXmls()} disabled={!connId || xmlsFetching}>
              <RefreshOutlined />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Config Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, pb: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setConfigOpen((v) => !v)}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
              API Configuration {savedCfg?.endpoint_url && `— ${savedCfg.endpoint_url}`}
            </Typography>
            {configOpen ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
          </Box>
        </CardContent>

        <Collapse in={configOpen}>
          <CardContent sx={{ pt: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* URL + Method + Content-Type */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField
                  label="Endpoint URL" placeholder="https://api.example.com/import"
                  value={cfg.endpoint_url ?? ''} onChange={(e) => setCfg({ ...cfg, endpoint_url: e.target.value })}
                  sx={{ flex: 3, minWidth: 240 }}
                />
                <FormControl sx={{ minWidth: 100 }}>
                  <InputLabel>Method</InputLabel>
                  <Select value={cfg.method ?? 'POST'} label="Method"
                    onChange={(e) => setCfg({ ...cfg, method: e.target.value })}>
                    {METHODS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl sx={{ minWidth: 160 }}>
                  <InputLabel>Content-Type</InputLabel>
                  <Select value={cfg.content_type ?? 'application/xml'} label="Content-Type"
                    onChange={(e) => setCfg({ ...cfg, content_type: e.target.value })}>
                    {CTYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>

              {/* Auth row */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <FormControl sx={{ minWidth: 140 }}>
                  <InputLabel>Auth Type</InputLabel>
                  <Select value={cfg.auth_type ?? 'none'} label="Auth Type"
                    onChange={(e) => setCfg({ ...cfg, auth_type: e.target.value, auth_value: '' })}>
                    {AUTH_TYPES.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
                  </Select>
                </FormControl>

                {cfg.auth_type !== 'none' && (
                  <>
                    {cfg.auth_type === 'apikey' && (
                      <TextField
                        label="Header Name" placeholder="X-API-Key"
                        value={cfg.auth_header_name ?? ''}
                        onChange={(e) => setCfg({ ...cfg, auth_header_name: e.target.value })}
                        sx={{ minWidth: 160 }}
                      />
                    )}
                    <TextField
                      label={cfg.auth_type === 'basic' ? 'Username:Password' : 'Token / Value'}
                      placeholder={cfg.auth_type === 'basic' ? 'user:password' : 'your-token'}
                      type={showAuthVal ? 'text' : 'password'}
                      value={cfg.auth_value ?? ''}
                      onChange={(e) => setCfg({ ...cfg, auth_value: e.target.value })}
                      sx={{ flex: 1, minWidth: 200 }}
                      InputProps={{
                        endAdornment: (
                          <IconButton size="small" onClick={() => setShowAuthVal((v) => !v)}>
                            {showAuthVal ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                          </IconButton>
                        ),
                      }}
                      helperText={savedCfg?.has_auth_value && !cfg.auth_value ? 'Token saved — leave blank to keep existing' : ''}
                    />
                  </>
                )}
              </Box>

              {/* Extra headers */}
              <TextField
                label="Extra Headers (JSON)" placeholder='{"X-Client-Id": "123", "X-Source": "clarity"}'
                value={cfg.extra_headers ?? ''} onChange={(e) => setCfg({ ...cfg, extra_headers: e.target.value })}
                multiline rows={2}
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
              />

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="contained" startIcon={<SaveOutlined />}
                  onClick={() => saveCfgMut.mutate()}
                  disabled={!connId || saveCfgMut.isPending}>
                  {saveCfgMut.isPending ? 'Saving…' : 'Save Configuration'}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Collapse>
      </Card>

      {/* XMLs table */}
      {!connId ? (
        <Alert severity="info">Select a connection to see generated XMLs.</Alert>
      ) : xmlRows.length === 0 ? (
        <Alert severity="warning">
          No generated XMLs found. Go to the Output tab and click "Generate All XML" first.
        </Alert>
      ) : (
        <Card>
          <CardContent sx={{ p: 0 }}>
            <TableContainer component={Paper} elevation={0}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Identifier</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Validation</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Dispatch</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">HTTP</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Time</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Retries</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Request</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Response</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Run</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {xmlRows.map((row: XmlDispatchRow) => {
                    const localLog = localLogs[row.xml_id]
                    const dStatus  = localLog?.status ?? row.dispatch_status
                    const dHttp    = localLog?.response_status ?? row.response_status
                    const dTime    = localLog?.response_time_ms ?? row.response_time_ms
                    const dRetries = localLog?.retry_count ?? row.retry_count
                    const dError   = localLog?.error_message
                    const isSending = sendingIds.has(row.xml_id)

                    return (
                      <TableRow
                        key={row.xml_id}
                        sx={{
                          bgcolor: dStatus === 'fail'
                            ? (t) => alpha(t.palette.error.main, 0.04)
                            : dStatus === 'success'
                            ? (t) => alpha(t.palette.success.main, 0.04)
                            : undefined,
                        }}
                      >
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                            {row.identifier_value ?? `#${row.xml_id}`}
                          </Typography>
                        </TableCell>

                        <TableCell>{VALIDATION_CHIP(row.validation_status)}</TableCell>

                        <TableCell>
                          {isSending
                            ? <Chip label="Sending…" size="small" color="info" icon={<CircularProgress size={12} />} />
                            : STATUS_CHIP(dStatus)}
                          {dError && (
                            <Tooltip title={dError}>
                              <Typography variant="caption" color="error" sx={{ display: 'block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {dError}
                              </Typography>
                            </Tooltip>
                          )}
                        </TableCell>

                        <TableCell align="center">
                          {dHttp ? (
                            <Chip
                              label={dHttp}
                              size="small"
                              color={dHttp > 0 && dHttp < 300 ? 'success' : 'error'}
                              variant="outlined"
                            />
                          ) : '—'}
                        </TableCell>

                        <TableCell align="center">
                          <Typography variant="caption" color="text.secondary">
                            {dTime ? `${dTime}ms` : '—'}
                          </Typography>
                        </TableCell>

                        <TableCell align="center">
                          <Typography variant="caption">{dRetries ?? 0}</Typography>
                        </TableCell>

                        {/* Request preview */}
                        <TableCell align="center">
                          <Tooltip title="View XML request body">
                            <span>
                              <IconButton size="small" disabled={isSending}
                                onClick={() => {
                                  const content = localLog?.request_body ?? '(Click Run to send first)'
                                  openPayload('Request Body', content)
                                }}>
                                <HelpOutlineOutlined fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>

                        {/* Response preview */}
                        <TableCell align="center">
                          <Tooltip title="View API response">
                            <span>
                              <IconButton size="small"
                                disabled={!dStatus || isSending}
                                onClick={() => openPayload(
                                  `Response — ${row.identifier_value ?? `#${row.xml_id}`}`,
                                  localLog?.response_body ?? '(no response)',
                                  dHttp ?? undefined,
                                  dTime ?? undefined,
                                )}>
                                <VisibilityOutlined fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>

                        {/* Run button */}
                        <TableCell align="center">
                          <Tooltip title={dStatus === 'success' ? 'Re-send' : 'Send'}>
                            <span>
                              <IconButton
                                size="small"
                                color={dStatus === 'success' ? 'default' : 'primary'}
                                disabled={!cfg.endpoint_url || isSending || sendAllMut.isPending}
                                onClick={() => sendOneMut.mutate(row.xml_id)}
                              >
                                {isSending
                                  ? <CircularProgress size={16} />
                                  : dStatus === 'success'
                                  ? <ReplayOutlined fontSize="small" />
                                  : <PlayArrowOutlined fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {connId && (
        <AiCfgDialog
          open={aiOpen}
          connId={connId as number}
          onApply={handleAiApply}
          onClose={() => setAiOpen(false)}
        />
      )}

      <PayloadDialog
        open={payloadDlg.open}
        title={payloadDlg.title}
        content={payloadDlg.content}
        status={payloadDlg.status}
        timeMs={payloadDlg.timeMs}
        onClose={() => setPayloadDlg({ open: false, title: '', content: '' })}
      />
    </Box>
  )
}
