import { useState, useRef, useEffect } from 'react'
import {
  Box, Typography, Button, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip, Paper, alpha, CircularProgress, Alert, Stack,
  Avatar, TextField, Divider, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import {
  AddOutlined, EditOutlined, DeleteOutlined, PlayArrowOutlined,
  StorageOutlined, CheckCircleOutlineOutlined, ErrorOutlineOutlined,
  AcUnitOutlined, SmartToyOutlined, PersonOutlined, SendOutlined,
  ContentPasteOutlined, AutoAwesomeOutlined, TuneOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { connectionsApi, chatApi } from '@/api'
import ConnectionForm, { DEFAULT_SQL, DEFAULT_SF } from '@/components/connections/ConnectionForm'
import { tokens } from '@/theme/theme'
import type { SourceConnection, ConnectionCreate } from '@/types'

// ── AI wizard system prompt ───────────────────────────────────────────────────
const AI_SYSTEM_PROMPT = `You are a database connection setup wizard for Clarity Studio.
Help the user configure a SQL Server, PostgreSQL, MySQL, SQLite or Snowflake connection.
Ask for: connection name, database type, host/server, port, database, schema, username, password, and an optional SQL query.
When you have all required info, output a JSON code block like:
\`\`\`json
{"name":"...","source_type":"sql","dialect":"mssql","host":"...","port":1433,"database_name":"...","schema_name":"dbo","username":"...","password":"...","query_text":"SELECT TOP 100 * FROM ...","sheet_alias":""}
\`\`\`
For Snowflake connections use source_type "snowflake" and fields: sf_account, sf_warehouse, sf_role, sf_database, sf_schema, sf_username.
Snowflake supports TWO authentication methods — always ask which one:
1. Password auth: include sf_password in the JSON.
2. Key-pair auth: include sf_private_key (PEM content of the .p8 file) and optionally sf_private_key_passphrase.
If the user says they are using a private key / RSA key / .p8 file, use key-pair auth and ask them to paste the PEM content.
Keep responses concise and friendly. When you output the JSON block, also confirm the configuration in plain text.`

interface ChatMsg { role: 'user' | 'assistant'; content: string }

function extractConfig(content: string): ConnectionCreate | null {
  const m = content.match(/```json\s*([\s\S]*?)\s*```/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1])
    if (parsed.name && parsed.source_type) return parsed as ConnectionCreate
  } catch { /* ignore */ }
  return null
}

// ── AI Chat panel (shown inside dialog when mode = 'ai') ─────────────────────
function AIConnectionWizard({ onApply }: { onApply: (cfg: ConnectionCreate) => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput]       = useState('')
  const [extracted, setExtracted] = useState<ConnectionCreate | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const chatMut = useMutation({
    mutationFn: (userMsg: string) => {
      const history: Array<{ role: string; content: string }> = [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMsg },
      ]
      return chatApi.send(history)
    },
    onSuccess: (res, userMsg) => {
      const assistantContent = res.message
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userMsg },
        { role: 'assistant', content: assistantContent },
      ])
      const cfg = extractConfig(assistantContent)
      if (cfg) setExtracted(cfg)
      setInput('')
    },
  })

  const handleSend = () => {
    if (!input.trim() || chatMut.isPending) return
    chatMut.mutate(input.trim())
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const STARTERS = [
    'Connect to SQL Server',
    'Connect to PostgreSQL',
    'Set up Snowflake',
    'Snowflake with key-pair auth',
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 480 }}>
      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: (t) => alpha(t.palette.action.hover, 0.4) }}>
        {messages.length === 0 ? (
          <Box sx={{ textAlign: 'center', pt: 5, color: 'text.disabled' }}>
            <SmartToyOutlined sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              Hi! I'll help you configure your database connection.
            </Typography>
            <Typography variant="caption">
              Tell me what type of database you're connecting to.
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              {STARTERS.map((s) => (
                <Chip key={s} label={s} size="small" variant="outlined"
                  onClick={() => { setInput(s); }}
                  sx={{ cursor: 'pointer', fontSize: '0.75rem' }}
                />
              ))}
            </Box>
          </Box>
        ) : (
          messages.map((msg, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', mb: 1.5, gap: 1, alignItems: 'flex-end' }}>
              {msg.role === 'assistant' && (
                <Avatar sx={{ width: 28, height: 28, background: 'linear-gradient(135deg,#7c3aed,#2563eb)', mb: 0.25 }}>
                  <SmartToyOutlined sx={{ fontSize: 14 }} />
                </Avatar>
              )}
              <Box
                sx={{
                  maxWidth: '80%', p: 1.5, fontSize: '0.875rem',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                  bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                  color: msg.role === 'user' ? 'white' : 'text.primary',
                  border: msg.role === 'assistant' ? '1px solid' : 'none',
                  borderColor: 'divider', boxShadow: 1,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
                }}
              >
                {msg.content}
              </Box>
              {msg.role === 'user' && (
                <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.dark', mb: 0.25 }}>
                  <PersonOutlined sx={{ fontSize: 14 }} />
                </Avatar>
              )}
            </Box>
          ))
        )}
        {chatMut.isPending && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'text.secondary', mt: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption">AI is thinking…</Typography>
          </Box>
        )}
        <div ref={endRef} />
      </Box>

      {/* Apply extracted config */}
      {extracted && (
        <Alert
          severity="success"
          sx={{ borderRadius: 0, py: 0.75 }}
          action={
            <Button size="small" variant="contained" color="success"
              startIcon={<ContentPasteOutlined />}
              onClick={() => onApply(extracted)}
            >
              Apply to Form
            </Button>
          }
        >
          Connection config ready: <strong>{extracted.name}</strong> ({extracted.source_type})
        </Alert>
      )}

      {/* Input */}
      <Divider />
      <Box sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth size="small" multiline maxRows={3}
          placeholder="Describe your database or answer the AI's questions…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
        />
        <IconButton
          color="primary" onClick={handleSend}
          disabled={!input.trim() || chatMut.isPending}
          sx={{ mb: 0.25 }}
        >
          <SendOutlined />
        </IconButton>
      </Box>
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConnectionsPage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeProject    = useAppStore((s) => s.activeProject)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)

  const [dialogOpen, setDialogOpen]   = useState(false)
  const [dialogMode, setDialogMode]   = useState<'manual' | 'ai'>('manual')
  const [editTarget, setEditTarget]   = useState<SourceConnection | null>(null)
  const [formData, setFormData]       = useState<ConnectionCreate>({ ...DEFAULT_SQL })
  const [testStatus, setTestStatus]   = useState<Record<number, 'ok' | 'fail' | 'loading'>>({})
  const [deleteId, setDeleteId]       = useState<number | null>(null)

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn:  () => connectionsApi.list(activeProject?.id),
    enabled:  Boolean(activeProject?.id),
  })

  const saveMut = useMutation({
    mutationFn: (data: ConnectionCreate) =>
      editTarget
        ? connectionsApi.update(editTarget.id, data)
        : connectionsApi.create(data),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['connections', activeProject?.id] })
      setActiveConnection(saved)
      setDialogOpen(false)
      enqueueSnackbar(editTarget ? 'Connection updated' : 'Connection created', { variant: 'success' })
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      enqueueSnackbar(e.response?.data?.detail ?? 'Save failed', { variant: 'error' })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => connectionsApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['connections', activeProject?.id] })
      if (activeConnection?.id === id) setActiveConnection(null)
      setDeleteId(null)
      enqueueSnackbar('Connection deleted', { variant: 'info' })
    },
  })

  const handleNew = (mode: 'manual' | 'ai' = 'manual') => {
    setEditTarget(null)
    setFormData({ ...DEFAULT_SQL, project_id: activeProject?.id })
    setDialogMode(mode)
    setDialogOpen(true)
  }

  const handleEdit = (conn: SourceConnection) => {
    setEditTarget(conn)
    const base: ConnectionCreate = {
      name: conn.name,
      source_type: conn.source_type,
      project_id: conn.project_id,
      dialect: conn.dialect,
      host: conn.host,
      port: conn.port,
      database_name: conn.database_name,
      schema_name: conn.schema_name,
      username: conn.username,
      sf_account: conn.sf_account,
      sf_warehouse: conn.sf_warehouse,
      sf_role: conn.sf_role,
      sf_database: conn.sf_database,
      sf_schema: conn.sf_schema,
      sf_username: conn.sf_username,
      query_text: conn.query_text,
      sheet_alias: conn.sheet_alias,
    }
    setFormData(base)
    setDialogMode('manual')
    setDialogOpen(true)
  }

  const handleTest = async (conn: SourceConnection) => {
    setTestStatus((s) => ({ ...s, [conn.id]: 'loading' }))
    try {
      await connectionsApi.test(conn.id)
      setTestStatus((s) => ({ ...s, [conn.id]: 'ok' }))
      enqueueSnackbar(`"${conn.name}" connected successfully`, { variant: 'success' })
    } catch {
      setTestStatus((s) => ({ ...s, [conn.id]: 'fail' }))
      enqueueSnackbar(`"${conn.name}" connection failed`, { variant: 'error' })
    }
  }

  const handleAiApply = (cfg: ConnectionCreate) => {
    setFormData({ ...cfg, project_id: activeProject?.id })
    setDialogMode('manual')
  }

  const typeIcon = (conn: SourceConnection) =>
    conn.source_type === 'snowflake'
      ? <AcUnitOutlined sx={{ fontSize: 14, color: tokens.sky600 }} />
      : <StorageOutlined sx={{ fontSize: 14, color: tokens.indigo600 }} />

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 1.5 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Connections</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage data source connections for this project
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Set up connection with AI assistant">
          <Button
            variant="outlined"
            startIcon={<SmartToyOutlined />}
            onClick={() => handleNew('ai')}
            disabled={!activeProject}
            sx={{ borderStyle: 'dashed' }}
          >
            AI Setup
          </Button>
        </Tooltip>
        <Button
          variant="contained" startIcon={<AddOutlined />}
          onClick={() => handleNew('manual')} disabled={!activeProject}
        >
          New Connection
        </Button>
      </Box>

      {!activeProject && (
        <Alert severity="info">Select a project first to manage connections.</Alert>
      )}

      {activeProject && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Host / Account</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Database</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && connections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Box sx={{ color: 'text.disabled', textAlign: 'center' }}>
                      <StorageOutlined sx={{ fontSize: 36, opacity: 0.3, mb: 1 }} />
                      <Typography variant="body2">No connections yet</Typography>
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1.5 }}>
                        <Button size="small" variant="outlined" startIcon={<SmartToyOutlined />} onClick={() => handleNew('ai')}>
                          AI Setup
                        </Button>
                        <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={() => handleNew('manual')}>
                          Manual
                        </Button>
                      </Box>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
              {connections.map((conn) => {
                const ts = testStatus[conn.id]
                const isActive = activeConnection?.id === conn.id
                return (
                  <TableRow
                    key={conn.id}
                    hover
                    sx={{
                      ...(isActive && {
                        bgcolor: alpha(tokens.indigo600, 0.04),
                        '& td': { borderColor: alpha(tokens.indigo600, 0.12) },
                      }),
                    }}
                  >
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {typeIcon(conn)}
                        <Typography variant="body2" fontWeight={600}>{conn.name}</Typography>
                        {isActive && (
                          <Chip label="active" size="small" sx={{
                            height: 16, fontSize: '0.625rem', fontWeight: 700,
                            bgcolor: alpha(tokens.indigo600, 0.1), color: tokens.indigo600,
                          }} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {conn.source_type}{conn.dialect ? ` · ${conn.dialect}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{conn.host ?? conn.sf_account ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{conn.database_name ?? conn.sf_database ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      {ts === 'loading' && <CircularProgress size={14} />}
                      {ts === 'ok'      && <CheckCircleOutlineOutlined sx={{ fontSize: 16, color: 'success.main' }} />}
                      {ts === 'fail'    && <ErrorOutlineOutlined sx={{ fontSize: 16, color: 'error.main' }} />}
                      {!ts && <Typography variant="caption" color="text.disabled">—</Typography>}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" spacing={0.5}>
                        <Tooltip title="Test connection">
                          <IconButton size="small" onClick={() => handleTest(conn)} disabled={ts === 'loading'}>
                            <PlayArrowOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Set as active">
                          <IconButton size="small" onClick={() => setActiveConnection(conn)}>
                            <StorageOutlined sx={{ fontSize: 15, color: isActive ? tokens.indigo600 : undefined }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => handleEdit(conn)}>
                            <EditOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => setDeleteId(conn.id)}>
                            <DeleteOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          {editTarget ? 'Edit Connection' : 'New Connection'}
          {!editTarget && (
            <ToggleButtonGroup
              value={dialogMode} exclusive size="small"
              onChange={(_, v) => { if (v) setDialogMode(v) }}
              sx={{ ml: 'auto' }}
            >
              <ToggleButton value="manual" sx={{ px: 1.5, fontSize: '0.75rem' }}>
                <TuneOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Manual
              </ToggleButton>
              <ToggleButton value="ai" sx={{ px: 1.5, fontSize: '0.75rem' }}>
                <AutoAwesomeOutlined sx={{ fontSize: 14, mr: 0.5 }} /> AI Setup
              </ToggleButton>
            </ToggleButtonGroup>
          )}
        </DialogTitle>

        {dialogMode === 'ai' && !editTarget ? (
          <>
            <DialogContent dividers sx={{ p: 0 }}>
              <AIConnectionWizard onApply={handleAiApply} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, px: 1 }}>
                When AI extracts the config, click "Apply to Form" then switch to Manual to save.
              </Typography>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogContent dividers sx={{ pt: 2 }}>
              <ConnectionForm
                value={formData}
                onChange={setFormData}
                mode={editTarget ? 'edit' : 'create'}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={() => saveMut.mutate(formData)}
                disabled={saveMut.isPending || !formData.name}
              >
                {saveMut.isPending ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                {editTarget ? 'Save Changes' : 'Create'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteId != null} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Connection</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this connection? This cannot be undone and may break
            existing mappings and reports.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button
            variant="contained" color="error"
            onClick={() => deleteId != null && deleteMut.mutate(deleteId)}
            disabled={deleteMut.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
