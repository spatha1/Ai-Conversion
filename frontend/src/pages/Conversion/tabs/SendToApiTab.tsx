import { useState, useRef, useEffect, memo, useCallback } from 'react'
import {
  Box, Card, CardContent, Typography, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Chip, IconButton, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert, Divider, Collapse,
  alpha, List, ListItem, ListItemText, Tabs, Tab,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import {
  SendOutlined, SmartToyOutlined, SaveOutlined, ExpandMoreOutlined,
  ExpandLessOutlined, VisibilityOutlined, VisibilityOffOutlined,
  AttachFileOutlined, CloseOutlined, RefreshOutlined,
  CheckCircleOutlined, ErrorOutlined, HelpOutlineOutlined,
  PlayArrowOutlined, ReplayOutlined,
  HttpOutlined, FolderOutlined, CloudOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { dispatchApi, uiValidationApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { ApiDispatchConfig, ApiDispatchLog, XmlDispatchRow, DispatchType } from '@/types'
import ValidationStatusCell from '@/components/UIValidation/ValidationStatusCell'
import SetupDialog from '@/components/UIValidation/SetupDialog'
import BatchReportDialog from '@/components/UIValidation/BatchReportDialog'

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
const CTYPES     = ['application/xml', 'text/xml', 'application/json', 'text/plain']

const DISPATCH_TYPES: { value: DispatchType; label: string; icon: React.ReactNode }[] = [
  { value: 'api',        label: 'API',        icon: <HttpOutlined sx={{ fontSize: 16 }} /> },
  { value: 'sftp',       label: 'SFTP',       icon: <FolderOutlined sx={{ fontSize: 16 }} /> },
  { value: 'azure_blob', label: 'Azure Blob', icon: <CloudOutlined sx={{ fontSize: 16 }} /> },
]

function cfgIsReady(cfg: ApiDispatchConfig): boolean {
  const dt = cfg.dispatch_type ?? 'api'
  if (dt === 'api')        return Boolean(cfg.endpoint_url?.trim())
  if (dt === 'sftp')       return Boolean(cfg.sftp_host?.trim())
  if (dt === 'azure_blob') return Boolean(cfg.azure_container?.trim())
  return false
}

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
        AI Dispatch Configuration Assistant
        <IconButton sx={{ ml: 'auto' }} onClick={onClose}><CloseOutlined /></IconButton>
      </DialogTitle>
      <Divider />

      <DialogContent sx={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden', p: 2 }}>
        {/* Left — Chat */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box ref={chatRef} sx={{ flex: 1, overflowY: 'auto', pr: 1, mb: 2 }}>
            {history.length === 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Describe your dispatch destination — API endpoint, SFTP server, or Azure Blob storage.
                Paste documentation or describe the setup and I'll configure it for you.
              </Alert>
            )}
            {history.map((h, i) => (
              <Box key={i} sx={{
                mb: 1.5, display: 'flex',
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

          <Box>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
              <Tab label="Text" sx={{ minHeight: 36, textTransform: 'none' }} />
              <Tab label="File" sx={{ minHeight: 36, textTransform: 'none' }} />
            </Tabs>
            {tab === 0 && (
              <TextField
                fullWidth multiline rows={3}
                placeholder="Describe the API, SFTP server, or Azure Blob setup…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey && input.trim()) askMut.mutate() }}
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
              <Button variant="contained" fullWidth
                disabled={askMut.isPending || (!input.trim() && !file)}
                onClick={() => askMut.mutate()}>
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
              {([
                ['Type',          suggested.dispatch_type              ?? '—'],
                // API fields
                ['URL',          suggested.endpoint_url               ?? '—'],
                ['Method',       suggested.method                     ?? '—'],
                ['Auth Type',    suggested.auth_type                  ?? '—'],
                ['Auth Value',   suggested.auth_value ? '••••••' : '—'],
                // SFTP fields
                ['SFTP Host',    suggested.sftp_host                  ?? '—'],
                ['SFTP User',    suggested.sftp_username              ?? '—'],
                ['SFTP Path',    suggested.sftp_remote_path           ?? '—'],
                // Azure fields
                ['Azure Container', suggested.azure_container         ?? '—'],
                ['Blob Prefix',  suggested.azure_blob_prefix          ?? '—'],
              ] as [string, string][]).filter(([, v]) => v !== '—').map(([label, val]) => (
                <ListItem key={label} disablePadding sx={{ py: 0.5 }}>
                  <ListItemText
                    primary={label}
                    secondary={String(val)}
                    primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                    secondaryTypographyProps={{ variant: 'body2', sx: { fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' } }}
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
        <Button variant="contained" disabled={!suggested}
          onClick={() => { if (suggested) { onApply(suggested); onClose() } }}>
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
        {status !== undefined && status > 0 && (
          <Chip label={`HTTP ${status}`} size="small"
            color={status < 300 ? 'success' : 'error'} sx={{ ml: 1 }} />
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

// ─── Records table — memoized so cfg changes don't trigger re-renders ────────

interface RecordsTableProps {
  xmlRows:           XmlDispatchRow[]
  localLogs:         Record<number, ApiDispatchLog>
  sendingIds:        Set<number>
  isXml:             boolean
  cfgReady:          boolean
  sendAllBusy:       boolean
  connId:            number
  uiValidationReady: boolean | null
  validationEntity:  string
  onSendOne:         (xmlId: number) => void
  onPayload:         (title: string, content: string, status?: number, timeMs?: number) => void
}

const RecordsTable = memo(function RecordsTable({
  xmlRows, localLogs, sendingIds, isXml, cfgReady, sendAllBusy, connId, uiValidationReady, validationEntity, onSendOne, onPayload,
}: RecordsTableProps) {
  return (
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
                <TableCell sx={{ fontWeight: 700 }} align="center">Payload</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Response</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Run</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>UI Validate</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {xmlRows.map((row: XmlDispatchRow) => {
                const localLog  = localLogs[row.xml_id]
                const dStatus   = localLog?.status ?? row.dispatch_status
                const dHttp     = localLog?.response_status ?? row.response_status
                const dTime     = localLog?.response_time_ms ?? row.response_time_ms
                const dRetries  = localLog?.retry_count ?? row.retry_count
                const dError    = localLog?.error_message
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

                    <TableCell>
                      {isXml
                        ? VALIDATION_CHIP(row.validation_status)
                        : <Chip label="N/A" size="small" variant="outlined" sx={{ color: 'text.disabled', fontSize: '0.7rem' }} />}
                    </TableCell>

                    <TableCell>
                      {isSending
                        ? <Chip label="Sending…" size="small" color="info" icon={<CircularProgress size={12} />} />
                        : STATUS_CHIP(dStatus)}
                      {dError && (
                        <Tooltip title={dError}>
                          <Typography variant="caption" color="error"
                            sx={{ display: 'block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {dError}
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>

                    <TableCell align="center">
                      {dHttp && dHttp > 0
                        ? <Chip label={dHttp} size="small" color={dHttp < 300 ? 'success' : 'error'} variant="outlined" />
                        : '—'}
                    </TableCell>

                    <TableCell align="center">
                      <Typography variant="caption" color="text.secondary">
                        {dTime ? `${dTime}ms` : '—'}
                      </Typography>
                    </TableCell>

                    <TableCell align="center">
                      <Typography variant="caption">{dRetries ?? 0}</Typography>
                    </TableCell>

                    <TableCell align="center">
                      <Tooltip title="View request payload">
                        <span>
                          <IconButton size="small" disabled={isSending}
                            onClick={() => onPayload('Request Payload', localLog?.request_body ?? '(Click Run to send first)')}>
                            <HelpOutlineOutlined fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>

                    <TableCell align="center">
                      <Tooltip title="View response">
                        <span>
                          <IconButton size="small" disabled={!dStatus || isSending}
                            onClick={() => onPayload(
                              `Response — ${row.identifier_value ?? `#${row.xml_id}`}`,
                              localLog?.response_body ?? '(no response)',
                              dHttp ?? undefined, dTime ?? undefined,
                            )}>
                            <VisibilityOutlined fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>

                    <TableCell align="center">
                      <Tooltip title={dStatus === 'success' ? 'Re-send' : 'Send'}>
                        <span>
                          <IconButton
                            size="small"
                            color={dStatus === 'success' ? 'default' : 'primary'}
                            disabled={!cfgReady || isSending || sendAllBusy}
                            onClick={() => onSendOne(row.xml_id)}
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

                    <TableCell>
                      {row.identifier_value ? (
                        <ValidationStatusCell
                          connId={connId}
                          entity={validationEntity}
                          entityId={row.identifier_value}
                          configured={uiValidationReady ?? undefined}
                        />
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  )
})

// ─── Main component ───────────────────────────────────────────────────────────

export default function SendToApiTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const { activeConnection, templateFormat } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const isXml  = templateFormat === 'xml'

  const [configOpen, setConfigOpen] = useState(true)
  const [aiOpen,     setAiOpen]     = useState(false)
  const [showPwd,    setShowPwd]    = useState(false)
  const [showAuth,   setShowAuth]   = useState(false)
  const [payloadDlg, setPayloadDlg] = useState<{
    open: boolean; title: string; content: string; status?: number; timeMs?: number
  }>({ open: false, title: '', content: '' })

  const [localLogs,  setLocalLogs]  = useState<Record<number, ApiDispatchLog>>({})
  const [sendingIds, setSendingIds] = useState<Set<number>>(new Set())

  // Config form state — defaults
  const [cfg, setCfg] = useState<ApiDispatchConfig>({
    dispatch_type: 'api',
    method: 'POST', content_type: 'application/xml', auth_type: 'none',
    sftp_port: 22,
  })
  const dispatchType = cfg.dispatch_type ?? 'api'

  // Load saved config when connection changes
  const { data: savedCfg } = useQuery<ApiDispatchConfig>({
    queryKey: ['dispatch-config', connId],
    queryFn: () => dispatchApi.getConfig(connId as number),
    enabled: Boolean(connId),
  })

  useEffect(() => {
    if (savedCfg) setCfg({ ...savedCfg, auth_value: '', sftp_password: '', azure_conn_str: '' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCfg])

  // Load records list
  const { data: xmlRows = [], refetch: refetchXmls, isFetching: xmlsFetching } = useQuery({
    queryKey: ['dispatch-xmls', connId],
    queryFn: () => dispatchApi.listXmls(connId as number),
    enabled: Boolean(connId),
  })

  const saveCfgMut = useMutation({
    mutationFn: () => dispatchApi.saveConfig(connId as number, cfg),
    onSuccess: () => {
      enqueueSnackbar('Dispatch configuration saved', { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['dispatch-config', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const sendOneMut = useMutation({
    mutationFn: (xmlId: number) => dispatchApi.sendOne(connId as number, xmlId),
    onSuccess: (log: ApiDispatchLog, xmlId: number) => {
      setSendingIds((prev) => { const s = new Set(prev); s.delete(xmlId); return s })
      setLocalLogs((prev) => ({ ...prev, [xmlId]: log }))
      enqueueSnackbar(
        log.status === 'success'
          ? `Dispatched ${log.identifier_value} successfully`
          : `Failed: ${log.error_message}`,
        { variant: log.status === 'success' ? 'success' : 'error' },
      )
      refetchXmls()
    },
    onError: (e: Error, xmlId: number) => {
      setSendingIds((prev) => { const s = new Set(prev); s.delete(xmlId); return s })
      enqueueSnackbar(e.message, { variant: 'error' })
    },
  })

  const sendAllMut = useMutation({
    mutationFn: () => dispatchApi.sendAll(connId as number),
    onSuccess: (r: { sent: number; failed: number; total: number }) => {
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
      dispatch_type:    (aiCfg.dispatch_type    ?? prev.dispatch_type) as DispatchType,
      endpoint_url:     aiCfg.endpoint_url      ?? prev.endpoint_url,
      method:           aiCfg.method            ?? prev.method,
      content_type:     aiCfg.content_type      ?? prev.content_type,
      auth_type:        aiCfg.auth_type         ?? prev.auth_type,
      auth_value:       aiCfg.auth_value        ?? prev.auth_value,
      auth_header_name: aiCfg.auth_header_name  ?? prev.auth_header_name,
      extra_headers:    aiCfg.extra_headers     ?? prev.extra_headers,
      sftp_host:        aiCfg.sftp_host         ?? prev.sftp_host,
      sftp_port:        aiCfg.sftp_port         ?? prev.sftp_port,
      sftp_username:    aiCfg.sftp_username     ?? prev.sftp_username,
      sftp_password:    aiCfg.sftp_password     ?? prev.sftp_password,
      sftp_remote_path: aiCfg.sftp_remote_path  ?? prev.sftp_remote_path,
      azure_conn_str:   aiCfg.azure_conn_str    ?? prev.azure_conn_str,
      azure_container:  aiCfg.azure_container   ?? prev.azure_container,
      azure_blob_prefix:aiCfg.azure_blob_prefix ?? prev.azure_blob_prefix,
    }))
    enqueueSnackbar('AI configuration applied — review and save', { variant: 'info' })
    setConfigOpen(true)
  }

  const validatedCount = xmlRows.filter((r: XmlDispatchRow) => r.validation_status === 'pass').length
  const readyCount     = isXml ? validatedCount : xmlRows.length
  const successCount   = xmlRows.filter((r: XmlDispatchRow) =>
    (localLogs[r.xml_id]?.status ?? r.dispatch_status) === 'success').length
  const failCount      = xmlRows.filter((r: XmlDispatchRow) =>
    (localLogs[r.xml_id]?.status ?? r.dispatch_status) === 'fail').length

  const openPayload = useCallback((title: string, content: string, status?: number, timeMs?: number) =>
    setPayloadDlg({ open: true, title, content, status, timeMs }), [])

  // ── UI Validation setup (one per connection) ──────────────
  const [uiSetupOpen,       setUiSetupOpen]       = useState(false)
  const [uiValidationReady, setUiValidationReady] = useState<boolean | null>(null)
  const [validationEntity,  setValidationEntity]  = useState<string>('record')
  const [batchRuns,         setBatchRuns]         = useState<import('@/types').UiValidationRun[]>([])
  const [batchRunning,      setBatchRunning]       = useState(false)
  const [batchReportOpen,   setBatchReportOpen]   = useState(false)

  useEffect(() => {
    if (!connId) return
    uiValidationApi.getStatus(connId as number)
      .then((s) => {
        setUiValidationReady(s.configured)
        const firstEntity = Object.keys(s.entity_paths ?? {})[0]
        setValidationEntity(firstEntity || 'record')
      })
      .catch(() => setUiValidationReady(false))
  }, [connId])

  const handleValidateAll = async () => {
    const rows = xmlRows.filter((r: XmlDispatchRow) => r.identifier_value)
    if (!rows.length) return
    setBatchRunning(true)
    setBatchRuns([])
    const results: import('@/types').UiValidationRun[] = []
    for (const row of rows) {
      try {
        const run = await uiValidationApi.run({
          connection_id: connId as number,
          entity:        validationEntity,
          entity_id:     row.identifier_value!,
        })
        results.push(run)
        setBatchRuns([...results])
      } catch {
        // continue with remaining rows
      }
    }
    setBatchRunning(false)
    setBatchReportOpen(true)
  }

  const handleSendOne = useCallback((xmlId: number) => {
    setSendingIds((prev) => new Set([...prev, xmlId]))
    sendOneMut.mutate(xmlId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendOneMut])

  // Dispatch type summary for collapsed header
  const cfgSummary = (() => {
    if (dispatchType === 'sftp') return savedCfg?.sftp_host ? `SFTP — ${savedCfg.sftp_host}` : 'SFTP'
    if (dispatchType === 'azure_blob') return savedCfg?.azure_container ? `Azure Blob — ${savedCfg.azure_container}` : 'Azure Blob'
    return savedCfg?.endpoint_url ? `API — ${savedCfg.endpoint_url}` : 'API'
  })()

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
            <Chip label={`${xmlRows.length} records`} variant="outlined" size="small" />
            {isXml && <Chip label={`${validatedCount} validated`} color="success" variant="outlined" size="small" />}
            {successCount > 0 && <Chip label={`${successCount} sent`} color="primary" size="small" />}
            {failCount    > 0 && <Chip label={`${failCount} failed`} color="error" size="small" />}
          </>
        )}
        <Button
          variant="contained"
          startIcon={sendAllMut.isPending ? <CircularProgress size={16} color="inherit" /> : <SendOutlined />}
          onClick={() => sendAllMut.mutate()}
          disabled={!connId || !cfgIsReady(cfg) || readyCount === 0 || sendAllMut.isPending}
          color="primary"
        >
          {sendAllMut.isPending
            ? 'Dispatching…'
            : isXml
            ? `Send All Validated (${validatedCount})`
            : `Dispatch All (${readyCount})`}
        </Button>
        {uiValidationReady && xmlRows.length > 0 && (
          <Button
            variant="outlined"
            color="secondary"
            startIcon={batchRunning ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
            onClick={handleValidateAll}
            disabled={batchRunning}
          >
            {batchRunning ? `Validating… (${batchRuns.length}/${xmlRows.length})` : `Validate All (${xmlRows.length})`}
          </Button>
        )}
        {batchRuns.length > 0 && !batchRunning && (
          <Button variant="outlined" onClick={() => setBatchReportOpen(true)}>
            View Batch Report ({batchRuns.filter(r => r.status === 'PASS').length}/{batchRuns.length} passed)
          </Button>
        )}
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
              Dispatch Configuration — {cfgSummary}
            </Typography>
            {configOpen ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
          </Box>
        </CardContent>

        <Collapse in={configOpen}>
          <CardContent sx={{ pt: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Dispatch type selector */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                  Dispatch Via
                </Typography>
                <ToggleButtonGroup
                  value={dispatchType}
                  exclusive
                  size="small"
                  onChange={(_, v) => { if (v) setCfg((prev) => ({ ...prev, dispatch_type: v as DispatchType })) }}
                >
                  {DISPATCH_TYPES.map(({ value, label, icon }) => (
                    <ToggleButton key={value} value={value} sx={{ gap: 0.75, px: 2, textTransform: 'none', fontSize: '0.813rem' }}>
                      {icon}{label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>

              <Divider />

              {/* ── API fields ───────────────────── */}
              {dispatchType === 'api' && (
                <>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      label="Endpoint URL" placeholder="https://api.example.com/import"
                      value={cfg.endpoint_url ?? ''}
                      onChange={(e) => setCfg({ ...cfg, endpoint_url: e.target.value })}
                      sx={{ flex: 3, minWidth: 240 }}
                    />
                    <FormControl sx={{ minWidth: 100 }}>
                      <InputLabel>Method</InputLabel>
                      <Select value={cfg.method ?? 'POST'} label="Method"
                        onChange={(e) => setCfg({ ...cfg, method: e.target.value })}>
                        {METHODS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 180 }}>
                      <InputLabel>Content-Type</InputLabel>
                      <Select value={cfg.content_type ?? 'application/xml'} label="Content-Type"
                        onChange={(e) => setCfg({ ...cfg, content_type: e.target.value })}>
                        {CTYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Box>

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
                          type={showAuth ? 'text' : 'password'}
                          value={cfg.auth_value ?? ''}
                          onChange={(e) => setCfg({ ...cfg, auth_value: e.target.value })}
                          sx={{ flex: 1, minWidth: 200 }}
                          InputProps={{
                            endAdornment: (
                              <IconButton size="small" onClick={() => setShowAuth((v) => !v)}>
                                {showAuth ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                              </IconButton>
                            ),
                          }}
                          helperText={savedCfg?.has_auth_value && !cfg.auth_value
                            ? 'Token saved — leave blank to keep existing' : ''}
                        />
                      </>
                    )}
                  </Box>

                  <TextField
                    label="Extra Headers (JSON)" placeholder='{"X-Client-Id": "123"}'
                    value={cfg.extra_headers ?? ''}
                    onChange={(e) => setCfg({ ...cfg, extra_headers: e.target.value })}
                    multiline rows={2}
                    sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
                  />
                </>
              )}

              {/* ── SFTP fields ──────────────────── */}
              {dispatchType === 'sftp' && (
                <>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      label="SFTP Host" placeholder="sftp.example.com"
                      value={cfg.sftp_host ?? ''}
                      onChange={(e) => setCfg({ ...cfg, sftp_host: e.target.value })}
                      sx={{ flex: 2, minWidth: 200 }}
                    />
                    <TextField
                      label="Port" type="number"
                      value={cfg.sftp_port ?? 22}
                      onChange={(e) => setCfg({ ...cfg, sftp_port: Number(e.target.value) })}
                      sx={{ width: 100 }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      label="Username"
                      value={cfg.sftp_username ?? ''}
                      onChange={(e) => setCfg({ ...cfg, sftp_username: e.target.value })}
                      sx={{ flex: 1, minWidth: 150 }}
                    />
                    <TextField
                      label="Password"
                      type={showPwd ? 'text' : 'password'}
                      value={cfg.sftp_password ?? ''}
                      onChange={(e) => setCfg({ ...cfg, sftp_password: e.target.value })}
                      sx={{ flex: 1, minWidth: 150 }}
                      InputProps={{
                        endAdornment: (
                          <IconButton size="small" onClick={() => setShowPwd((v) => !v)}>
                            {showPwd ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                          </IconButton>
                        ),
                      }}
                      helperText={savedCfg?.has_sftp_password && !cfg.sftp_password
                        ? 'Password saved — leave blank to keep existing' : ''}
                    />
                  </Box>
                  <TextField
                    label="Remote Path" placeholder="/uploads/{identifier}.xml"
                    value={cfg.sftp_remote_path ?? ''}
                    onChange={(e) => setCfg({ ...cfg, sftp_remote_path: e.target.value })}
                    helperText="{identifier} is replaced with each record's identifier value"
                  />
                </>
              )}

              {/* ── Azure Blob fields ────────────── */}
              {dispatchType === 'azure_blob' && (
                <>
                  <TextField
                    label="Azure Storage Connection String"
                    type={showPwd ? 'text' : 'password'}
                    value={cfg.azure_conn_str ?? ''}
                    onChange={(e) => setCfg({ ...cfg, azure_conn_str: e.target.value })}
                    placeholder="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
                    InputProps={{
                      endAdornment: (
                        <IconButton size="small" onClick={() => setShowPwd((v) => !v)}>
                          {showPwd ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                        </IconButton>
                      ),
                    }}
                    helperText={savedCfg?.has_azure_conn_str && !cfg.azure_conn_str
                      ? 'Connection string saved — leave blank to keep existing' : ''}
                  />
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      label="Container Name" placeholder="my-container"
                      value={cfg.azure_container ?? ''}
                      onChange={(e) => setCfg({ ...cfg, azure_container: e.target.value })}
                      sx={{ flex: 1, minWidth: 150 }}
                    />
                    <TextField
                      label="Blob Prefix / Path" placeholder="output/{identifier}"
                      value={cfg.azure_blob_prefix ?? ''}
                      onChange={(e) => setCfg({ ...cfg, azure_blob_prefix: e.target.value })}
                      sx={{ flex: 2, minWidth: 200 }}
                      helperText="{identifier} replaced per record; file extension added automatically"
                    />
                  </Box>
                </>
              )}

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

      {/* UI Validation — one-time setup banner per connection */}
      {connId && uiValidationReady === false && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button size="small" variant="outlined" startIcon={<SmartToyOutlined />}
              onClick={() => setUiSetupOpen(true)}>
              Setup Validation
            </Button>
          }
        >
          Configure a UI validation template once for this connection — then validate any record against the target application UI after dispatch.
        </Alert>
      )}
      {connId && uiValidationReady === true && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          action={
            <Button size="small" variant="outlined"
              onClick={() => setUiSetupOpen(true)}>
              Reconfigure
            </Button>
          }
        >
          UI Validation template is configured. Click "UI Validate" next to any dispatched record to compare it against the target application.
        </Alert>
      )}

      {/* Records table — memoized, won't re-render when cfg changes */}
      {!connId ? (
        <Alert severity="info">Select a connection to see generated records.</Alert>
      ) : xmlRows.length === 0 ? (
        <Alert severity="warning">
          No generated records found. Go to the Output tab and click "Generate All" first.
        </Alert>
      ) : (
        <RecordsTable
          xmlRows={xmlRows}
          localLogs={localLogs}
          sendingIds={sendingIds}
          isXml={isXml}
          cfgReady={cfgIsReady(cfg)}
          sendAllBusy={sendAllMut.isPending}
          connId={connId as number}
          uiValidationReady={uiValidationReady}
          validationEntity={validationEntity}
          onSendOne={handleSendOne}
          onPayload={openPayload}
        />
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

      {/* UI Validation setup dialog */}
      {uiSetupOpen && connId && (
        <SetupDialog
          connId={connId as number}
          onClose={() => setUiSetupOpen(false)}
          onSaved={() => { setUiSetupOpen(false); setUiValidationReady(true) }}
        />
      )}

      {/* Batch validation report */}
      {batchReportOpen && (
        <BatchReportDialog
          runs={batchRuns}
          onClose={() => setBatchReportOpen(false)}
        />
      )}
    </Box>
  )
}
