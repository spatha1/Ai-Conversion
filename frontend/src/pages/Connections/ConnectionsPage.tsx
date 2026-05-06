import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Box, Typography, Button, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip, Paper, alpha, CircularProgress, Alert, Stack,
  Avatar, TextField, Divider, ToggleButtonGroup, ToggleButton,
  Collapse, Tabs, Tab, ListItemButton, ListItemText,
} from '@mui/material'
import {
  AddOutlined, EditOutlined, DeleteOutlined, PlayArrowOutlined,
  StorageOutlined, CheckCircleOutlineOutlined, ErrorOutlineOutlined,
  AcUnitOutlined, SmartToyOutlined, PersonOutlined, SendOutlined,
  ContentPasteOutlined, AutoAwesomeOutlined, TuneOutlined,
  TableChartOutlined, HistoryOutlined, ContentCopyOutlined,
  KeyOutlined, SearchOutlined, TrendingUpOutlined, WarningAmberOutlined,
  LightbulbOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { connectionsApi, chatApi, adminApi, performanceApi } from '@/api'
import ConnectionForm, { DEFAULT_SQL, DEFAULT_SF } from '@/components/connections/ConnectionForm'
import { tokens } from '@/theme/theme'
import type { SourceConnection, ConnectionCreate, QueryHistoryItem, QueryPerformanceAnalysis, QueryPerformanceStats } from '@/types'

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

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
  const [detailTab, setDetailTab]     = useState(0)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableSearch, setTableSearch] = useState('')

  const { data: catalog } = useQuery({
    queryKey: ['catalog', activeConnection?.id],
    queryFn: () => adminApi.getCatalog(activeConnection!.id),
    enabled: !!activeConnection && detailTab === 0,
  })

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ['queryHistory', activeConnection?.id],
    queryFn: () => connectionsApi.getHistory(activeConnection!.id),
    enabled: !!activeConnection && detailTab === 1,
  })

  const { data: perfStats } = useQuery<QueryPerformanceStats>({
    queryKey: ['perfStats', activeConnection?.id],
    queryFn: () => performanceApi.stats(activeConnection!.id),
    enabled: !!activeConnection && detailTab === 2,
  })

  const [perfAnalysis, setPerfAnalysis] = useState<QueryPerformanceAnalysis | null>(null)
  const [perfAnalyzing, setPerfAnalyzing] = useState(false)

  const handlePerfAnalyze = async () => {
    if (!activeConnection) return
    setPerfAnalyzing(true)
    try {
      const result = await performanceApi.analyze(activeConnection.id)
      setPerfAnalysis(result)
    } catch {
      enqueueSnackbar('Analysis failed', { variant: 'error' })
    } finally {
      setPerfAnalyzing(false)
    }
  }

  const clearHistoryMut = useMutation({
    mutationFn: () => connectionsApi.clearHistory(activeConnection!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queryHistory', activeConnection?.id] })
      enqueueSnackbar('Query history cleared', { variant: 'info' })
    },
  })

  const tableMap = useMemo(() => {
    const cols = catalog?.columns ?? []
    const map: Record<string, typeof cols> = {}
    for (const col of cols) {
      if (!map[col.table_name]) map[col.table_name] = []
      map[col.table_name].push(col)
    }
    return map
  }, [catalog])

  const filteredTables = useMemo(() => {
    const tables = Object.keys(tableMap).sort()
    if (!tableSearch) return tables
    return tables.filter((t) => t.toLowerCase().includes(tableSearch.toLowerCase()))
  }, [tableMap, tableSearch])

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

      {/* Connection Detail Panel */}
      <Collapse in={!!activeConnection} unmountOnExit>
        <Paper variant="outlined" sx={{ mt: 2, borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, pt: 1.5, pb: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <StorageOutlined sx={{ fontSize: 15, color: tokens.indigo600 }} />
            <Typography variant="body2" fontWeight={700} color={tokens.indigo600}>
              {activeConnection?.name}
            </Typography>
          </Box>
          <Tabs
            value={detailTab}
            onChange={(_, v) => setDetailTab(v)}
            sx={{ px: 1, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
          >
            <Tab icon={<TableChartOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Schema Browser" sx={{ minHeight: 40, fontSize: '0.8rem', py: 0 }} />
            <Tab icon={<HistoryOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Query History" sx={{ minHeight: 40, fontSize: '0.8rem', py: 0 }} />
            <Tab icon={<TrendingUpOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Performance" sx={{ minHeight: 40, fontSize: '0.8rem', py: 0 }} />
          </Tabs>

          {/* Schema Browser */}
          {detailTab === 0 && (
            <Box sx={{ display: 'flex', height: 360 }}>
              {/* Left: table list */}
              <Box sx={{ width: 240, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ p: 1 }}>
                  <TextField
                    size="small" fullWidth placeholder="Search tables…"
                    value={tableSearch}
                    onChange={(e) => { setTableSearch(e.target.value); setSelectedTable(null) }}
                    InputProps={{ startAdornment: <SearchOutlined sx={{ fontSize: 16, mr: 0.5, color: 'text.disabled' }} /> }}
                    inputProps={{ sx: { fontSize: '0.8rem', py: 0.75 } }}
                  />
                </Box>
                {filteredTables.length === 0 && (
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
                    <Typography variant="caption">
                      {Object.keys(tableMap).length === 0 ? 'Run "Collect Schema" in Admin first' : 'No tables match'}
                    </Typography>
                  </Box>
                )}
                <Box sx={{ flex: 1, overflowY: 'auto' }}>
                  {filteredTables.map((tableName) => (
                    <ListItemButton
                      key={tableName}
                      selected={selectedTable === tableName}
                      onClick={() => setSelectedTable(tableName)}
                      dense
                      sx={{ py: 0.5 }}
                    >
                      <ListItemText
                        primary={<Typography variant="body2" fontSize="0.8rem" fontWeight={selectedTable === tableName ? 700 : 400}>{tableName}</Typography>}
                        secondary={<Typography variant="caption" color="text.disabled">{tableMap[tableName].length} cols</Typography>}
                        sx={{ my: 0 }}
                      />
                    </ListItemButton>
                  ))}
                </Box>
              </Box>

              {/* Right: columns */}
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                {!selectedTable ? (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
                    <Typography variant="caption">Select a table to see its columns</Typography>
                  </Box>
                ) : (
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>Column</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>Nullable</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>PK</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(tableMap[selectedTable] ?? []).map((col, idx) => (
                        <TableRow key={col.column_name} hover>
                          <TableCell sx={{ fontSize: '0.75rem', color: 'text.disabled', width: 32 }}>{idx + 1}</TableCell>
                          <TableCell sx={{ fontSize: '0.8rem', fontWeight: 500 }}>{col.column_name}</TableCell>
                          <TableCell>
                            <Chip label={col.data_type ?? '?'} size="small" sx={{ fontSize: '0.68rem', height: 18 }} />
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.75rem', color: col.is_nullable ? 'warning.main' : 'text.disabled' }}>
                            {col.is_nullable ? 'YES' : 'NO'}
                          </TableCell>
                          <TableCell>
                            {col.is_primary_key && <KeyOutlined sx={{ fontSize: 14, color: tokens.amber500 ?? 'warning.main' }} />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            </Box>
          )}

          {/* Performance */}
          {detailTab === 2 && (
            <Box sx={{ p: 2 }}>
              {/* Summary chips */}
              <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                <Chip
                  icon={<HistoryOutlined sx={{ fontSize: 14 }} />}
                  label={`${perfStats?.total_queries ?? 0} total queries`}
                  size="small" variant="outlined"
                />
                <Chip
                  icon={<WarningAmberOutlined sx={{ fontSize: 14 }} />}
                  label={`${perfStats?.slow_count ?? 0} slow`}
                  size="small"
                  color={perfStats?.slow_count ? 'warning' : 'default'}
                  variant={perfStats?.slow_count ? 'filled' : 'outlined'}
                />
                {(perfStats?.avg_slow_ms ?? 0) > 0 && (
                  <Chip label={`avg ${perfStats!.avg_slow_ms}ms`} size="small" variant="outlined" />
                )}
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small" variant="contained"
                  startIcon={perfAnalyzing ? <CircularProgress size={13} color="inherit" /> : <LightbulbOutlined sx={{ fontSize: 14 }} />}
                  onClick={handlePerfAnalyze}
                  disabled={perfAnalyzing || (perfStats?.slow_count ?? 0) === 0}
                  sx={{ fontSize: '0.75rem' }}
                >
                  AI Analyze
                </Button>
              </Stack>

              {/* Slow query list */}
              {(perfStats?.slow_queries ?? []).length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center', color: 'text.disabled' }}>
                  <TrendingUpOutlined sx={{ fontSize: 32, opacity: 0.3, mb: 0.5 }} />
                  <Typography variant="caption" display="block">No slow queries detected — run queries to build performance data</Typography>
                </Box>
              ) : (
                <Table size="small" sx={{ mb: perfAnalysis ? 2 : 0 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Query</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 80 }}>Duration</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 60 }}>Rows</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 120 }}>Reason</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 80 }}>When</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(perfStats?.slow_queries ?? []).map((q) => (
                      <TableRow key={q.id} hover sx={{ bgcolor: (t) => alpha(t.palette.error.main, 0.04) }}>
                        <TableCell sx={{ maxWidth: 0, width: '50%' }}>
                          <Tooltip title={q.query_text} placement="top-start">
                            <Typography variant="body2" fontSize="0.78rem"
                              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}
                            >
                              {q.query_text}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={`${q.duration_ms}ms`} size="small"
                            color={q.duration_ms > 10000 ? 'error' : 'warning'}
                            sx={{ fontSize: '0.7rem', height: 20 }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.78rem' }}>
                          {q.row_count != null ? q.row_count.toLocaleString() : '—'}
                        </TableCell>
                        <TableCell>
                          {q.slowness_reason?.split(' | ').map((r) => (
                            <Chip key={r} label={r} size="small" variant="outlined"
                              sx={{ fontSize: '0.65rem', height: 18, mr: 0.3, mb: 0.3 }} />
                          ))}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                          {formatRelative(q.executed_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* AI Analysis result */}
              {perfAnalysis && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mt: 2 }}>
                  <Typography variant="body2" fontWeight={700} mb={1} display="flex" alignItems="center" gap={0.5}>
                    <LightbulbOutlined sx={{ fontSize: 16, color: 'warning.main' }} /> AI Analysis
                    <Chip label={`${perfAnalysis.tokens_in + perfAnalysis.tokens_out} tokens`} size="small" sx={{ fontSize: '0.65rem', height: 18, ml: 'auto' }} />
                    <Chip label={`${perfAnalysis.latency_ms}ms`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                  </Typography>

                  <Alert severity="info" sx={{ mb: 1.5, py: 0.5, fontSize: '0.8rem' }}>{perfAnalysis.narrative}</Alert>

                  {perfAnalysis.regression_summary && (
                    <Alert severity="warning" sx={{ mb: 1.5, py: 0.5, fontSize: '0.8rem' }}>
                      <strong>Regression: </strong>{perfAnalysis.regression_summary}
                    </Alert>
                  )}

                  {perfAnalysis.index_suggestions.length > 0 && (
                    <>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                        INDEX SUGGESTIONS
                      </Typography>
                      <Stack spacing={1} mb={1.5}>
                        {perfAnalysis.index_suggestions.map((s, i) => (
                          <Paper key={i} variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="body2" fontSize="0.8rem" fontWeight={600}>{s.table}</Typography>
                            <Typography variant="caption" color="primary.main" fontFamily="monospace" display="block">
                              ({s.columns.join(', ')})
                            </Typography>
                            <Typography variant="caption" color="text.secondary">{s.rationale}</Typography>
                          </Paper>
                        ))}
                      </Stack>
                    </>
                  )}

                  {perfAnalysis.top_offenders.length > 0 && (
                    <>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                        TOP OFFENDERS
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Pattern</TableCell>
                            <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', width: 80 }}>Avg ms</TableCell>
                            <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', width: 60 }}>Count</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {perfAnalysis.top_offenders.map((o, i) => (
                            <TableRow key={i}>
                              <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{o.query_pattern}</TableCell>
                              <TableCell sx={{ fontSize: '0.75rem' }}>{o.avg_ms}</TableCell>
                              <TableCell sx={{ fontSize: '0.75rem' }}>{o.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </Paper>
              )}
            </Box>
          )}

          {/* Query History */}
          {detailTab === 1 && (
            <Box>
              <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Last {history.length} queries</Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small" color="error" variant="text"
                  onClick={() => clearHistoryMut.mutate()}
                  disabled={clearHistoryMut.isPending || history.length === 0}
                  sx={{ fontSize: '0.72rem' }}
                >
                  Clear History
                </Button>
              </Box>
              {history.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center', color: 'text.disabled' }}>
                  <HistoryOutlined sx={{ fontSize: 32, opacity: 0.3, mb: 0.5 }} />
                  <Typography variant="caption" display="block">No queries yet — run a query in Reports to see history here</Typography>
                </Box>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Query</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 70 }}>Rows</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 70 }}>Time</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 80 }}>When</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 40 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.map((h: QueryHistoryItem) => (
                      <TableRow key={h.id} hover>
                        <TableCell sx={{ maxWidth: 0, width: '60%' }}>
                          <Tooltip title={h.query_text} placement="top-start">
                            <Typography
                              variant="body2" fontSize="0.78rem"
                              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}
                            >
                              {h.query_text}
                            </Typography>
                          </Tooltip>
                          {h.status === 'error' && (
                            <Typography variant="caption" color="error.main" display="block" sx={{ fontSize: '0.68rem' }}>
                              {h.error_msg}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.78rem' }}>
                          {h.row_count != null ? h.row_count.toLocaleString() : '—'}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                          {h.duration_ms != null ? `${h.duration_ms}ms` : '—'}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                          {formatRelative(h.executed_at)}
                        </TableCell>
                        <TableCell>
                          <Tooltip title="Copy SQL">
                            <IconButton size="small" onClick={() => { navigator.clipboard.writeText(h.query_text); enqueueSnackbar('SQL copied', { variant: 'success' }) }}>
                              <ContentCopyOutlined sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          )}
        </Paper>
      </Collapse>

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
