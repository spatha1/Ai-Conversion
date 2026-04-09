import { useState, useRef } from 'react'
import {
  Box, Typography, Paper, Button, IconButton, Chip, TextField,
  Select, MenuItem, FormControl, InputLabel, Divider, Alert,
  CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions, Tab, Tabs, Table, TableHead, TableRow, TableCell,
  TableBody, Checkbox, alpha,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, SaveOutlined, PlayArrowOutlined,
  ApiOutlined, EditOutlined, CheckCircleOutlined, ErrorOutlined,
  FileUploadOutlined, AutoAwesomeOutlined, CloseOutlined,
  TextSnippetOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { psApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import type { PsApiEntry } from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const METHOD_COLORS: Record<string, string> = {
  GET: '#10b981', POST: '#2563eb', PUT: '#d97706',
  PATCH: '#7c3aed', DELETE: '#ef4444',
}

const EMPTY_FORM = {
  name: '',
  method: 'POST',
  url: '',
  description: '',
  headers_json: '{\n  "Content-Type": "application/json"\n}',
  body_template: '',
  required_fields: '',
  auth_type: 'none',
  auth_value: '',
  conn_id: '' as number | '',
}

type FormState = typeof EMPTY_FORM

// ── Method Badge ──────────────────────────────────────────────────────────────
function MethodBadge({ method }: { method: string }) {
  const color = METHOD_COLORS[method?.toUpperCase()] ?? '#64748b'
  return (
    <Chip
      label={method}
      size="small"
      sx={{ bgcolor: `${color}18`, color, fontWeight: 700, fontSize: '0.625rem', height: 20, minWidth: 44 }}
    />
  )
}

// ── JSON Field ────────────────────────────────────────────────────────────────
function JsonField({ label, value, onChange, placeholder, minRows = 4 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number
}) {
  const isValid = !value.trim() || (() => { try { JSON.parse(value); return true } catch { return false } })()
  return (
    <TextField
      fullWidth multiline minRows={minRows} label={label} value={value}
      onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      error={!isValid} helperText={!isValid ? 'Invalid JSON' : undefined}
      inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }} size="small"
    />
  )
}

// ── Test Panel (Postman-style) ────────────────────────────────────────────────
function TestPanel({ entry }: { entry: PsApiEntry }) {
  const [testTab, setTestTab]   = useState(0)
  const [url, setUrl]           = useState(entry.url ?? '')
  const [headers, setHeaders]   = useState(entry.headers_json ?? '{\n  "Content-Type": "application/json"\n}')
  const [body, setBody]         = useState(entry.body_template ?? '')
  const [params, setParams]     = useState('') // query params as JSON
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<{ status: number; statusText: string; body: string; headers: Record<string,string>; elapsed: number } | null>(null)
  const [resTab, setResTab]     = useState(0)
  const [error, setError]       = useState('')

  const statusColor = result
    ? result.status < 300 ? '#10b981' : result.status < 400 ? '#f59e0b' : '#ef4444'
    : '#64748b'

  const handleSend = async () => {
    setLoading(true); setResult(null); setError('')
    const t0 = performance.now()
    try {
      // Build URL with query params
      let finalUrl = url.trim()
      if (params.trim()) {
        try {
          const p = JSON.parse(params)
          const qs = new URLSearchParams(p).toString()
          finalUrl += (finalUrl.includes('?') ? '&' : '?') + qs
        } catch { setError('Query params must be valid JSON'); setLoading(false); return }
      }
      // Build headers
      let parsedHeaders: Record<string,string> = {}
      if (headers.trim()) {
        try { parsedHeaders = JSON.parse(headers) }
        catch { setError('Headers must be valid JSON'); setLoading(false); return }
      }
      // Build body
      let bodyStr: string | undefined
      if (body.trim() && !['GET','HEAD'].includes(entry.method)) {
        bodyStr = body.trim()
      }

      const resp = await fetch(finalUrl, {
        method: entry.method,
        headers: parsedHeaders,
        body: bodyStr,
      })
      const elapsed = Math.round(performance.now() - t0)
      const text = await resp.text()
      let pretty = text
      try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch { /* keep raw */ }

      // Collect response headers
      const respHeaders: Record<string,string> = {}
      resp.headers.forEach((v, k) => { respHeaders[k] = v })

      setResult({ status: resp.status, statusText: resp.statusText, body: pretty, headers: respHeaders, elapsed })
      setResTab(0)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }

  return (
    <Box>
      {/* URL bar */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
        <Chip label={entry.method} size="small" sx={{
          bgcolor: `${METHOD_COLORS[entry.method] ?? '#64748b'}18`,
          color: METHOD_COLORS[entry.method] ?? '#64748b',
          fontWeight: 700, fontSize: '0.75rem', height: 36, px: 0.5, borderRadius: 1.5,
        }} />
        <TextField
          fullWidth size="small" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/endpoint"
          inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
          sx={{ '& .MuiInputBase-root': { borderRadius: 1.5 } }}
        />
        <Button
          variant="contained" color="primary" onClick={handleSend} disabled={loading}
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlined />}
          sx={{ borderRadius: 1.5, minWidth: 90, flexShrink: 0 }}
        >
          {loading ? 'Sending' : 'Send'}
        </Button>
      </Box>

      {/* Request tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2 }}>
        <Tabs value={testTab} onChange={(_, v) => setTestTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 38, bgcolor: 'action.hover' }}>
          {['Headers', 'Body', 'Query Params'].map((label, i) => (
            <Tab key={i} label={label} sx={{ textTransform: 'none', minHeight: 38, fontSize: '0.78rem', py: 0 }} />
          ))}
        </Tabs>
        <Box sx={{ p: 1.5 }}>
          {testTab === 0 && (
            <JsonField label="Request Headers (JSON)" value={headers} onChange={setHeaders}
              placeholder={'{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer ..."\n}'} minRows={4} />
          )}
          {testTab === 1 && (
            ['GET', 'HEAD'].includes(entry.method)
              ? <Typography variant="caption" color="text.disabled">GET requests do not have a body.</Typography>
              : <JsonField label="Request Body (JSON)" value={body} onChange={setBody}
                  placeholder='{\n  "key": "value"\n}' minRows={5} />
          )}
          {testTab === 2 && (
            <JsonField label='Query Parameters (JSON) — e.g. {"page": "1", "limit": "20"}' value={params}
              onChange={setParams} placeholder='{"key": "value"}' minRows={3} />
          )}
        </Box>
      </Paper>

      {/* Error */}
      {error && <Alert severity="error" sx={{ mb: 1.5, fontSize: '0.75rem', borderRadius: 1.5 }}>{error}</Alert>}

      {/* Response */}
      {result && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {/* Response status bar */}
          <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 2, bgcolor: `${statusColor}10`, borderBottom: 1, borderColor: 'divider' }}>
            <Chip
              label={`${result.status} ${result.statusText}`}
              size="small"
              sx={{ bgcolor: `${statusColor}20`, color: statusColor, fontWeight: 700, fontSize: '0.75rem', height: 22 }}
            />
            <Typography variant="caption" color="text.secondary">
              Time: <strong>{result.elapsed} ms</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Size: <strong>{new Blob([result.body]).size} B</strong>
            </Typography>
          </Box>

          {/* Response tabs */}
          <Tabs value={resTab} onChange={(_, v) => setResTab(v)}
            sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 36, px: 1 }}>
            {['Body', 'Headers'].map((label, i) => (
              <Tab key={i} label={label} sx={{ textTransform: 'none', minHeight: 36, fontSize: '0.75rem', py: 0 }} />
            ))}
          </Tabs>

          {resTab === 0 && (
            <Box component="pre" sx={{
              m: 0, p: 2, maxHeight: 320, overflow: 'auto',
              fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6,
              bgcolor: '#0d1117', color: '#c9d1d9',
            }}>
              {result.body || '(empty response)'}
            </Box>
          )}
          {resTab === 1 && (
            <Box sx={{ p: 1.5, maxHeight: 240, overflow: 'auto' }}>
              {Object.entries(result.headers).map(([k, v]) => (
                <Box key={k} sx={{ display: 'flex', gap: 2, py: 0.25, '&:not(:last-child)': { borderBottom: 1, borderColor: 'divider' } }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main', minWidth: 180, flexShrink: 0 }}>{k}</Typography>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}>{v}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}
    </Box>
  )
}

function parseHeaders(json?: string): Record<string, string> {
  if (!json?.trim()) return {}
  try { return JSON.parse(json) } catch { return {} }
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────
function DeleteDialog({ open, name, onConfirm, onClose }: { open: boolean; name: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete API</DialogTitle>
      <DialogContent><Typography>Remove <strong>{name}</strong> from the collection?</Typography></DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Delete</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── AI Import Dialog ──────────────────────────────────────────────────────────
interface ExtractedApi {
  name: string; method: string; url: string; description: string
  headers_json?: string; body_template?: string; required_fields?: string
}

function AiImportDialog({
  open, onClose, onImported,
}: { open: boolean; onClose: () => void; onImported: (count: number) => void }) {
  const { enqueueSnackbar } = useSnackbar()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab]               = useState(0)
  const [file, setFile]             = useState<File | null>(null)
  const [freeText, setFreeText]     = useState('')
  const [connId, setConnId]         = useState<number | ''>('')
  const [extracting, setExtracting] = useState(false)
  const [importing, setImporting]   = useState(false)
  const [extracted, setExtracted]   = useState<ExtractedApi[] | null>(null)
  const [selected, setSelected]     = useState<Set<number>>(new Set())

  const reset = () => {
    setFile(null); setFreeText(''); setExtracted(null)
    setSelected(new Set()); setExtracting(false); setImporting(false); setTab(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => { reset(); onClose() }

  const handleExtract = async () => {
    if (!file && !freeText.trim()) {
      enqueueSnackbar('Upload a file or enter some text first', { variant: 'warning' }); return
    }
    setExtracting(true); setExtracted(null)
    try {
      const res = await psApi.aiExtractApis(file, freeText.trim() || undefined)
      const apis = (res.apis as ExtractedApi[])
      if (apis.length === 0) {
        enqueueSnackbar('No APIs found in the content. Try adding more detail.', { variant: 'warning' })
        setExtracting(false); return
      }
      setExtracted(apis)
      setSelected(new Set(apis.map((_, i) => i)))  // select all by default
    } catch (e: any) {
      enqueueSnackbar(e.response?.data?.detail || e.message, { variant: 'error' })
    } finally { setExtracting(false) }
  }

  const toggleAll = () => {
    if (!extracted) return
    if (selected.size === extracted.length) setSelected(new Set())
    else setSelected(new Set(extracted.map((_, i) => i)))
  }

  const handleImport = async () => {
    if (!extracted || selected.size === 0) return
    const toImport = extracted.filter((_, i) => selected.has(i))
    setImporting(true)
    try {
      const res = await psApi.importCollection(toImport, connId || null)
      enqueueSnackbar(`${res.imported} API${res.imported !== 1 ? 's' : ''} created successfully`, { variant: 'success' })
      onImported(res.imported)
      handleClose()
    } catch (e: any) {
      enqueueSnackbar(e.response?.data?.detail || e.message, { variant: 'error' })
    } finally { setImporting(false) }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="lg"
      PaperProps={{ sx: { borderRadius: 3, height: '85vh', display: 'flex', flexDirection: 'column' } }}>

      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0, bgcolor: (t) => alpha(t.palette.primary.main, 0.03) }}>
        <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AutoAwesomeOutlined sx={{ color: 'primary.main', fontSize: 18 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>AI API Import</Typography>
          <Typography variant="caption" color="text.secondary">
            Upload any document or paste text — AI extracts all APIs and bulk-creates them
          </Typography>
        </Box>
        <IconButton size="small" onClick={handleClose}><CloseOutlined fontSize="small" /></IconButton>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left: input panel ── */}
        <Box sx={{ width: 360, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider', minHeight: 44 }}>
            <Tab icon={<FileUploadOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Upload File" sx={{ textTransform: 'none', minHeight: 44, fontSize: '0.8rem' }} />
            <Tab icon={<TextSnippetOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Paste Text" sx={{ textTransform: 'none', minHeight: 44, fontSize: '0.8rem' }} />
          </Tabs>

          <Box sx={{ flex: 1, overflow: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* File upload tab */}
            {tab === 0 && (
              <Box>
                <input ref={fileRef} type="file" accept="*" style={{ display: 'none' }}
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setExtracted(null) }} />
                <Box
                  onClick={() => fileRef.current?.click()}
                  sx={{
                    border: 2, borderStyle: 'dashed', borderColor: file ? 'primary.main' : 'divider',
                    borderRadius: 2, p: 3, textAlign: 'center', cursor: 'pointer',
                    bgcolor: file ? (t) => alpha(t.palette.primary.main, 0.04) : 'transparent',
                    transition: 'all .15s',
                    '&:hover': { borderColor: 'primary.main', bgcolor: (t) => alpha(t.palette.primary.main, 0.04) },
                  }}
                >
                  <FileUploadOutlined sx={{ fontSize: 36, color: file ? 'primary.main' : 'text.disabled', mb: 1 }} />
                  {file ? (
                    <>
                      <Typography variant="body2" fontWeight={700} color="primary.main">{file.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{(file.size / 1024).toFixed(1)} KB — click to change</Typography>
                    </>
                  ) : (
                    <>
                      <Typography variant="body2" fontWeight={600}>Click to upload any file</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Postman JSON, PDF, DOCX, XLSX, CSV, TXT, Swagger/OpenAPI, etc.
                      </Typography>
                    </>
                  )}
                </Box>
                {file && (
                  <Button size="small" color="error" sx={{ mt: 1 }} onClick={() => { setFile(null); setExtracted(null); if (fileRef.current) fileRef.current.value = '' }}>
                    Remove file
                  </Button>
                )}
              </Box>
            )}

            {/* Free text tab */}
            {tab === 1 && (
              <TextField
                multiline rows={10} fullWidth size="small"
                label="Paste API descriptions, docs, or any text"
                placeholder={`Paste anything:\n\n• Swagger/OpenAPI YAML or JSON\n• API documentation text\n• Postman export\n• Plain English: "POST https://api.example.com/users to create a user with {name, email}"\n• Multiple APIs in one paste`}
                value={freeText}
                onChange={(e) => { setFreeText(e.target.value); setExtracted(null) }}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
              />
            )}

            {/* Connection selector — always visible */}
            <Box>
              <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Associate imported APIs with connection (optional)
              </Typography>
              <ConnectionSelector
                value={connId}
                onChange={(_, id) => setConnId(id)}
                label="Target Connection"
                size="small"
              />
            </Box>

            <Button
              variant="contained" fullWidth size="large"
              startIcon={extracting ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
              onClick={handleExtract}
              disabled={extracting || (!file && !freeText.trim())}
              sx={{ borderRadius: 1.5, mt: 'auto' }}
            >
              {extracting ? 'Extracting APIs…' : 'Extract APIs with AI'}
            </Button>
          </Box>
        </Box>

        {/* ── Right: preview panel ── */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Preview header */}
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
              {extracted == null
                ? 'Extracted APIs will appear here'
                : `${extracted.length} API${extracted.length !== 1 ? 's' : ''} found — ${selected.size} selected`}
            </Typography>
            {extracted && extracted.length > 0 && (
              <>
                <Button size="small" variant="outlined" onClick={toggleAll} sx={{ borderRadius: 1.5, fontSize: '0.7rem' }}>
                  {selected.size === extracted.length ? 'Deselect All' : 'Select All'}
                </Button>
                <Button
                  size="small" variant="contained" color="success"
                  startIcon={importing ? <CircularProgress size={14} color="inherit" /> : <CheckCircleOutlined />}
                  onClick={handleImport}
                  disabled={importing || selected.size === 0}
                  sx={{ borderRadius: 1.5, fontSize: '0.8rem' }}
                >
                  {importing ? 'Creating…' : `Create ${selected.size} API${selected.size !== 1 ? 's' : ''}`}
                </Button>
              </>
            )}
          </Box>

          {/* Preview content */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {extracted == null && !extracting && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled' }}>
                <AutoAwesomeOutlined sx={{ fontSize: 56, opacity: 0.3 }} />
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  Upload a document or paste text on the left,<br />then click "Extract APIs with AI"
                </Typography>
              </Box>
            )}

            {extracting && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                <CircularProgress size={28} />
                <Typography color="text.secondary">Analysing content and extracting APIs…</Typography>
              </Box>
            )}

            {extracted && extracted.length === 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1 }}>
                <ErrorOutlined sx={{ fontSize: 40, color: 'warning.main' }} />
                <Typography variant="body2" color="text.secondary">No APIs found. Try adding more detail or a different document.</Typography>
              </Box>
            )}

            {extracted && extracted.length > 0 && (
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ width: 40 }}>
                      <Checkbox size="small" checked={selected.size === extracted.length} indeterminate={selected.size > 0 && selected.size < extracted.length} onChange={toggleAll} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 80 }}>Method</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 180 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>URL</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Body Fields</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {extracted.map((api, i) => {
                    const isChecked = selected.has(i)
                    const bodyKeys = (() => {
                      if (!api.body_template) return []
                      try {
                        const obj = JSON.parse(api.body_template)
                        return Object.keys(obj).slice(0, 4)
                      } catch { return [] }
                    })()
                    return (
                      <TableRow
                        key={i}
                        hover
                        onClick={() => setSelected((prev) => {
                          const next = new Set(prev); isChecked ? next.delete(i) : next.add(i); return next
                        })}
                        sx={{
                          cursor: 'pointer',
                          opacity: isChecked ? 1 : 0.45,
                          bgcolor: isChecked ? (t) => alpha(t.palette.primary.main, 0.03) : 'transparent',
                        }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={isChecked} onChange={() => {}} />
                        </TableCell>
                        <TableCell><MethodBadge method={api.method} /></TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.8rem' }}>{api.name}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>{api.url}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                            {api.description ? (api.description.length > 100 ? api.description.slice(0, 100) + '…' : api.description) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {bodyKeys.length > 0 ? (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.375 }}>
                              {bodyKeys.map((k) => (
                                <Chip key={k} label={k} size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
                              ))}
                            </Box>
                          ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Box>
        </Box>
      </Box>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ApiCollectionPage() {
  const qc = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { activeProject } = useAppStore()

  const [filterConnId, setFilterConnId] = useState<number | ''>('')
  const [selected, setSelected] = useState<PsApiEntry | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [isNew, setIsNew] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PsApiEntry | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const { data: apis = [], isLoading } = useQuery({
    queryKey: ['ps-api-collection', filterConnId, activeProject?.id],
    queryFn: () => psApi.listApiCollection(filterConnId || undefined, activeProject?.id),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ps-api-collection'] })

  const createMutation = useMutation({
    mutationFn: (data: Omit<PsApiEntry, 'id'>) => psApi.createApiEntry(data),
    onSuccess: (saved) => { invalidate(); setSelected(saved); setIsNew(false); enqueueSnackbar('API created', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<PsApiEntry, 'id'>> }) => psApi.updateApiEntry(id, data),
    onSuccess: (saved) => { invalidate(); setSelected(saved); enqueueSnackbar('API updated', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => psApi.deleteApiEntry(id),
    onSuccess: () => {
      invalidate(); setSelected(null); setForm(EMPTY_FORM); setIsNew(false)
      setDeleteTarget(null); enqueueSnackbar('API deleted', { variant: 'info' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const handleSelectApi = (entry: PsApiEntry) => {
    setSelected(entry); setIsNew(false); setTestOpen(false)
    setForm({
      name: entry.name ?? '', method: entry.method ?? 'POST', url: entry.url ?? '',
      description: entry.description ?? '',
      headers_json: entry.headers_json ?? '{\n  "Content-Type": "application/json"\n}',
      body_template: entry.body_template ?? '',
      required_fields: entry.required_fields ?? '',
      auth_type: entry.auth_type ?? 'none', auth_value: '',
      conn_id: entry.conn_id ?? '',
    })
  }

  const handleNewApi = () => { setSelected(null); setIsNew(true); setTestOpen(false); setForm(EMPTY_FORM) }

  const handleSave = () => {
    if (!form.name.trim() || !form.url.trim()) { enqueueSnackbar('Name and URL are required', { variant: 'warning' }); return }
    if (form.headers_json.trim()) {
      try { JSON.parse(form.headers_json) }
      catch { enqueueSnackbar('Headers must be valid JSON', { variant: 'error' }); return }
    }
    const payload = {
      name: form.name.trim(), method: form.method, url: form.url.trim(),
      description: form.description.trim() || undefined,
      headers_json: form.headers_json.trim() || undefined,
      body_template: form.body_template.trim() || undefined,
      required_fields: form.required_fields.trim() || undefined,
      auth_type: form.auth_type, auth_value: form.auth_value || undefined,
      conn_id: form.conn_id || undefined,
    }
    if (isNew) createMutation.mutate(payload)
    else if (selected) updateMutation.mutate({ id: selected.id, data: payload })
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const hasSelection = isNew || selected !== null
  const f = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <ApiOutlined color="primary" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>API Collection</Typography>
          <Typography variant="caption" color="text.secondary">Manage the REST APIs available to the AI agent</Typography>
        </Box>
        <ConnectionSelector value={filterConnId} onChange={(_, id) => { setFilterConnId(id); setSelected(null); setIsNew(false) }} label="Filter by Connection" size="small" />
        <Button
          variant="outlined" startIcon={<AutoAwesomeOutlined />}
          onClick={() => setImportOpen(true)} size="small" sx={{ borderRadius: 1.5 }}
        >
          AI Import
        </Button>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={handleNewApi} size="small" sx={{ borderRadius: 1.5 }}>
          New API
        </Button>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left panel: API list ── */}
        <Box sx={{ width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {apis.length} {apis.length === 1 ? 'API' : 'APIs'} registered
            </Typography>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={24} /></Box>}
            {!isLoading && apis.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
                <ApiOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" color="text.secondary" fontWeight={500}>No APIs added yet</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                  Create manually or use AI Import to extract from a document.
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Button variant="outlined" size="small" startIcon={<AddOutlined />} onClick={handleNewApi}>New API</Button>
                  <Button variant="outlined" size="small" color="secondary" startIcon={<AutoAwesomeOutlined />} onClick={() => setImportOpen(true)}>AI Import</Button>
                </Box>
              </Box>
            )}
            {apis.map((entry) => {
              const isActive = !isNew && selected?.id === entry.id
              return (
                <Box key={entry.id} onClick={() => handleSelectApi(entry)} sx={{
                  p: 1.25, mb: 0.5, borderRadius: 1.5, border: '1px solid',
                  borderColor: isActive ? 'primary.main' : 'divider',
                  bgcolor: isActive ? (t) => `${t.palette.primary.main}08` : 'background.paper',
                  cursor: 'pointer', transition: 'all .15s',
                  '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.light' },
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                    <MethodBadge method={entry.method} />
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>{entry.name}</Typography>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry) }}
                        sx={{ opacity: 0, '.MuiBox-root:hover &': { opacity: 1 }, '&:hover': { color: 'error.main' } }}>
                        <DeleteOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', fontSize: '0.65rem', fontFamily: 'monospace' }}>{entry.url}</Typography>
                  {entry.description && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>{entry.description}</Typography>}
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* ── Right panel: editor ── */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          {!hasSelection ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 1.5, color: 'text.disabled' }}>
              <ApiOutlined sx={{ fontSize: 56, opacity: 0.3 }} />
              <Typography variant="h6" color="text.secondary">Select an API to edit</Typography>
              <Typography variant="body2" color="text.disabled">or click New API / AI Import to get started</Typography>
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ maxWidth: 720, mx: 'auto', p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
                <EditOutlined color="primary" sx={{ fontSize: 20 }} />
                <Typography variant="h6" fontWeight={700}>{isNew ? 'New API' : `Edit — ${selected?.name}`}</Typography>
                <Box sx={{ flex: 1 }} />
                {!isNew && selected && (
                  <Button size="small" variant="outlined" startIcon={<PlayArrowOutlined />} onClick={() => setTestOpen((v) => !v)}>
                    {testOpen ? 'Hide Test' : 'Test'}
                  </Button>
                )}
                <Button variant="contained" size="small"
                  startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                  onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField label="Name *" value={form.name} onChange={f('name')} fullWidth size="small" placeholder="e.g. Update Employee Status" />
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <FormControl size="small" sx={{ minWidth: 110 }}>
                    <InputLabel>Method</InputLabel>
                    <Select label="Method" value={form.method} onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}>
                      {METHODS.map((m) => (
                        <MenuItem key={m} value={m}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: METHOD_COLORS[m] }} />
                            {m}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField label="URL *" value={form.url} onChange={f('url')} fullWidth size="small"
                    placeholder="https://api.example.com/endpoint"
                    inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }} />
                </Box>
                <TextField label="Description" value={form.description} onChange={f('description')} fullWidth size="small" multiline rows={2}
                  placeholder="What this API does — the AI agent reads this to decide when to call it" />
                <ConnectionSelector value={form.conn_id} onChange={(_, id) => setForm((p) => ({ ...p, conn_id: id }))} label="Restrict to Connection (optional)" size="small" />
                <Divider />
                <JsonField label='Headers (JSON) — e.g. {"Authorization": "Bearer {{token}}"}' value={form.headers_json}
                  onChange={(v) => setForm((p) => ({ ...p, headers_json: v }))}
                  placeholder={'{\n  "Content-Type": "application/json"\n}'} minRows={3} />
                <JsonField label='Body Template — use {{field_name}} for dynamic values' value={form.body_template}
                  onChange={(v) => setForm((p) => ({ ...p, body_template: v }))}
                  placeholder={'{\n  "id": "{{employee_id}}",\n  "status": "{{new_status}}"\n}'} minRows={4} />
                <TextField label='Required Fields (JSON array) — fields the AI must fetch before calling this API'
                  value={form.required_fields} onChange={f('required_fields')} fullWidth size="small"
                  placeholder='["employee_id", "deptno"]'
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                  helperText='The AI reads this list to know which SQL columns to SELECT before building the payload'
                  error={!!form.required_fields.trim() && (() => { try { JSON.parse(form.required_fields); return false } catch { return true } })()}
                />
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Auth Type</InputLabel>
                    <Select label="Auth Type" value={form.auth_type} onChange={(e) => setForm((p) => ({ ...p, auth_type: e.target.value }))}>
                      <MenuItem value="none">None</MenuItem>
                      <MenuItem value="bearer">Bearer Token</MenuItem>
                      <MenuItem value="basic">Basic Auth</MenuItem>
                    </Select>
                  </FormControl>
                  {form.auth_type !== 'none' && (
                    <TextField label={form.auth_type === 'bearer' ? 'Bearer Token' : 'user:password'}
                      value={form.auth_value} onChange={f('auth_value')} fullWidth size="small" type="password"
                      placeholder={form.auth_type === 'bearer' ? 'eyJ…' : 'username:password'}
                      helperText={!isNew && selected?.has_auth ? 'Leave blank to keep existing credential' : undefined}
                    />
                  )}
                </Box>
                {testOpen && selected && (
                  <><Divider /><TestPanel entry={{ ...selected, headers_json: form.headers_json, body_template: form.body_template }} /></>
                )}
              </Box>
            </Paper>
          )}
        </Box>
      </Box>

      <DeleteDialog
        open={Boolean(deleteTarget)} name={deleteTarget?.name ?? ''}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />

      <AiImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => invalidate()}
      />
    </Box>
  )
}
