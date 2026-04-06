import { useState } from 'react'
import {
  Box, Typography, Paper, Button, IconButton, Chip, TextField,
  Select, MenuItem, FormControl, InputLabel, Divider, Alert,
  CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, SaveOutlined, PlayArrowOutlined,
  ApiOutlined, EditOutlined, CheckCircleOutlined, ErrorOutlined,
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
      sx={{
        bgcolor: `${color}18`, color, fontWeight: 700,
        fontSize: '0.625rem', height: 20, minWidth: 44,
      }}
    />
  )
}

// ── JSON Field ────────────────────────────────────────────────────────────────
function JsonField({
  label, value, onChange, placeholder, minRows = 4,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}) {
  const isValid = !value.trim() || (() => {
    try { JSON.parse(value); return true } catch { return false }
  })()

  return (
    <Box>
      <TextField
        fullWidth multiline minRows={minRows}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        error={!isValid}
        helperText={!isValid ? 'Invalid JSON' : undefined}
        inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
        size="small"
      />
    </Box>
  )
}

// ── Test Panel ────────────────────────────────────────────────────────────────
function TestPanel({ entry }: { entry: PsApiEntry }) {
  const [body, setBody] = useState(entry.body_template ?? '')
  const [result, setResult] = useState<{ status: number; body: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleTest = async () => {
    setLoading(true); setResult(null); setError('')
    try {
      let parsedBody: Record<string, unknown> | undefined
      if (body.trim()) {
        try { parsedBody = JSON.parse(body) }
        catch { setError('Request body is not valid JSON'); setLoading(false); return }
      }
      const resp = await fetch(entry.url, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json', ...parseHeaders(entry.headers_json) },
        body: parsedBody ? JSON.stringify(parsedBody) : undefined,
      })
      const text = await resp.text()
      let pretty = text
      try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch { /* keep raw */ }
      setResult({ status: resp.status, body: pretty })
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        TEST REQUEST
      </Typography>
      <JsonField
        label="Request Body (JSON)"
        value={body}
        onChange={setBody}
        placeholder='{"key": "value"}'
        minRows={3}
      />
      <Button
        variant="outlined" size="small"
        startIcon={loading ? <CircularProgress size={14} /> : <PlayArrowOutlined />}
        onClick={handleTest}
        disabled={loading}
        sx={{ mt: 1 }}
      >
        {loading ? 'Sending…' : 'Send Request'}
      </Button>
      {error && <Alert severity="error" sx={{ mt: 1, fontSize: '0.75rem' }}>{error}</Alert>}
      {result && (
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            {result.status < 400
              ? <CheckCircleOutlined sx={{ color: 'success.main', fontSize: 16 }} />
              : <ErrorOutlined sx={{ color: 'error.main', fontSize: 16 }} />}
            <Typography variant="caption" fontWeight={700}>
              HTTP {result.status}
            </Typography>
          </Box>
          <Box
            component="pre"
            sx={{
              p: 1, borderRadius: 1, bgcolor: 'action.hover',
              fontSize: 11, fontFamily: 'monospace',
              overflowX: 'auto', maxHeight: 200, overflowY: 'auto',
              m: 0,
            }}
          >
            {result.body}
          </Box>
        </Box>
      )}
    </Box>
  )
}

function parseHeaders(json?: string): Record<string, string> {
  if (!json?.trim()) return {}
  try { return JSON.parse(json) } catch { return {} }
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────
function DeleteDialog({
  open, name, onConfirm, onClose,
}: { open: boolean; name: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete API</DialogTitle>
      <DialogContent>
        <Typography>Remove <strong>{name}</strong> from the collection?</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Delete</Button>
      </DialogActions>
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

  const { data: apis = [], isLoading } = useQuery({
    queryKey: ['ps-api-collection', filterConnId, activeProject?.id],
    queryFn: () => psApi.listApiCollection(filterConnId || undefined, activeProject?.id),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ps-api-collection'] })

  const createMutation = useMutation({
    mutationFn: (data: Omit<PsApiEntry, 'id'>) => psApi.createApiEntry(data),
    onSuccess: (saved) => {
      invalidate()
      setSelected(saved)
      setIsNew(false)
      enqueueSnackbar('API created', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<PsApiEntry, 'id'>> }) =>
      psApi.updateApiEntry(id, data),
    onSuccess: (saved) => {
      invalidate()
      setSelected(saved)
      enqueueSnackbar('API updated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => psApi.deleteApiEntry(id),
    onSuccess: () => {
      invalidate()
      setSelected(null)
      setForm(EMPTY_FORM)
      setIsNew(false)
      setDeleteTarget(null)
      enqueueSnackbar('API deleted', { variant: 'info' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const handleSelectApi = (entry: PsApiEntry) => {
    setSelected(entry)
    setIsNew(false)
    setTestOpen(false)
    setForm({
      name:            entry.name ?? '',
      method:          entry.method ?? 'POST',
      url:             entry.url ?? '',
      description:     entry.description ?? '',
      headers_json:    entry.headers_json ?? '{\n  "Content-Type": "application/json"\n}',
      body_template:   entry.body_template ?? '',
      required_fields: entry.required_fields ?? '',
      auth_type:       entry.auth_type ?? 'none',
      auth_value:      '',
      conn_id:         entry.conn_id ?? '',
    })
  }

  const handleNewApi = () => {
    setSelected(null)
    setIsNew(true)
    setTestOpen(false)
    setForm(EMPTY_FORM)
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.url.trim()) {
      enqueueSnackbar('Name and URL are required', { variant: 'warning' })
      return
    }
    if (form.headers_json.trim()) {
      try { JSON.parse(form.headers_json) }
      catch { enqueueSnackbar('Headers must be valid JSON', { variant: 'error' }); return }
    }

    const payload = {
      name:            form.name.trim(),
      method:          form.method,
      url:             form.url.trim(),
      description:     form.description.trim() || undefined,
      headers_json:    form.headers_json.trim() || undefined,
      body_template:   form.body_template.trim() || undefined,
      required_fields: form.required_fields.trim() || undefined,
      auth_type:       form.auth_type,
      auth_value:      form.auth_value || undefined,
      conn_id:         form.conn_id || undefined,
    }

    if (isNew) {
      createMutation.mutate(payload)
    } else if (selected) {
      updateMutation.mutate({ id: selected.id, data: payload })
    }
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
          <Typography variant="caption" color="text.secondary">
            Manage the REST APIs available to the AI agent
          </Typography>
        </Box>
        <ConnectionSelector
          value={filterConnId}
          onChange={(_, id) => { setFilterConnId(id); setSelected(null); setIsNew(false) }}
          label="Filter by Connection"
          size="small"
        />
        <Button variant="contained" startIcon={<AddOutlined />} onClick={handleNewApi} size="small">
          New API
        </Button>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left panel: API list ── */}
        <Box
          sx={{
            width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {apis.length} {apis.length === 1 ? 'API' : 'APIs'} registered
            </Typography>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
                <CircularProgress size={24} />
              </Box>
            )}

            {/* Empty state */}
            {!isLoading && apis.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
                <ApiOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  No APIs added yet
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                  Create your first API to let the AI agent call external services.
                </Typography>
                <Button variant="outlined" size="small" startIcon={<AddOutlined />} onClick={handleNewApi}>
                  Create your first API
                </Button>
              </Box>
            )}

            {/* API list */}
            {apis.map((entry) => {
              const isActive = !isNew && selected?.id === entry.id
              return (
                <Box
                  key={entry.id}
                  onClick={() => handleSelectApi(entry)}
                  sx={{
                    p: 1.25, mb: 0.5, borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: isActive ? 'primary.main' : 'divider',
                    bgcolor: isActive ? (t) => `${t.palette.primary.main}08` : 'background.paper',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.light' },
                    transition: 'all .15s',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                    <MethodBadge method={entry.method} />
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
                      {entry.name}
                    </Typography>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry) }}
                        sx={{ opacity: 0, '.MuiBox-root:hover &': { opacity: 1 }, '&:hover': { color: 'error.main' } }}
                      >
                        <DeleteOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    noWrap
                    sx={{ display: 'block', fontSize: '0.65rem', fontFamily: 'monospace' }}
                  >
                    {entry.url}
                  </Typography>
                  {entry.description && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
                      {entry.description}
                    </Typography>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* ── Right panel: editor ── */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          {!hasSelection ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 1, color: 'text.disabled' }}>
              <ApiOutlined sx={{ fontSize: 56, opacity: 0.3 }} />
              <Typography variant="h6" color="text.secondary">Select an API to edit</Typography>
              <Typography variant="body2" color="text.disabled">or click New API to create one</Typography>
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ maxWidth: 720, mx: 'auto', p: 3 }}>
              {/* Editor header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
                <EditOutlined color="primary" sx={{ fontSize: 20 }} />
                <Typography variant="h6" fontWeight={700}>
                  {isNew ? 'New API' : `Edit — ${selected?.name}`}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {!isNew && selected && (
                  <Button
                    size="small" variant="outlined"
                    startIcon={<PlayArrowOutlined />}
                    onClick={() => setTestOpen((v) => !v)}
                  >
                    {testOpen ? 'Hide Test' : 'Test'}
                  </Button>
                )}
                <Button
                  variant="contained" size="small"
                  startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

                {/* Name */}
                <TextField
                  label="Name *"
                  value={form.name}
                  onChange={f('name')}
                  fullWidth size="small"
                  placeholder="e.g. Update Employee Status"
                />

                {/* Method + URL */}
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <FormControl size="small" sx={{ minWidth: 110 }}>
                    <InputLabel>Method</InputLabel>
                    <Select
                      label="Method"
                      value={form.method}
                      onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
                    >
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
                  <TextField
                    label="URL *"
                    value={form.url}
                    onChange={f('url')}
                    fullWidth size="small"
                    placeholder="https://api.example.com/endpoint"
                    inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                  />
                </Box>

                {/* Description */}
                <TextField
                  label="Description"
                  value={form.description}
                  onChange={f('description')}
                  fullWidth size="small" multiline rows={2}
                  placeholder="What this API does — the AI agent reads this to decide when to call it"
                />

                {/* Connection */}
                <ConnectionSelector
                  value={form.conn_id}
                  onChange={(_, id) => setForm((p) => ({ ...p, conn_id: id }))}
                  label="Restrict to Connection (optional)"
                  size="small"
                />

                <Divider />

                {/* Headers */}
                <JsonField
                  label='Headers (JSON) — e.g. {"Authorization": "Bearer {{token}}"}'
                  value={form.headers_json}
                  onChange={(v) => setForm((p) => ({ ...p, headers_json: v }))}
                  placeholder={'{\n  "Content-Type": "application/json"\n}'}
                  minRows={3}
                />

                {/* Body Template */}
                <JsonField
                  label='Body Template — use {{field_name}} for dynamic values'
                  value={form.body_template}
                  onChange={(v) => setForm((p) => ({ ...p, body_template: v }))}
                  placeholder={'{\n  "id": "{{employee_id}}",\n  "status": "{{new_status}}"\n}'}
                  minRows={4}
                />

                {/* Required Fields */}
                <TextField
                  label='Required Fields (JSON array) — fields the AI must fetch before calling this API'
                  value={form.required_fields}
                  onChange={f('required_fields')}
                  fullWidth size="small"
                  placeholder='["employee_id", "deptno"]'
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                  helperText='The AI reads this list to know which SQL columns to SELECT before building the payload'
                  error={!!form.required_fields.trim() && (() => { try { JSON.parse(form.required_fields); return false } catch { return true } })()}
                />

                {/* Auth */}
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Auth Type</InputLabel>
                    <Select
                      label="Auth Type"
                      value={form.auth_type}
                      onChange={(e) => setForm((p) => ({ ...p, auth_type: e.target.value }))}
                    >
                      <MenuItem value="none">None</MenuItem>
                      <MenuItem value="bearer">Bearer Token</MenuItem>
                      <MenuItem value="basic">Basic Auth</MenuItem>
                    </Select>
                  </FormControl>
                  {form.auth_type !== 'none' && (
                    <TextField
                      label={form.auth_type === 'bearer' ? 'Bearer Token' : 'user:password'}
                      value={form.auth_value}
                      onChange={f('auth_value')}
                      fullWidth size="small" type="password"
                      placeholder={form.auth_type === 'bearer' ? 'eyJ…' : 'username:password'}
                      helperText={
                        !isNew && selected?.has_auth
                          ? 'Leave blank to keep existing credential'
                          : undefined
                      }
                    />
                  )}
                </Box>

                {/* Test panel */}
                {testOpen && selected && (
                  <>
                    <Divider />
                    <TestPanel entry={{ ...selected, headers_json: form.headers_json, body_template: form.body_template }} />
                  </>
                )}
              </Box>
            </Paper>
          )}
        </Box>
      </Box>

      {/* Delete confirm dialog */}
      <DeleteDialog
        open={Boolean(deleteTarget)}
        name={deleteTarget?.name ?? ''}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  )
}
